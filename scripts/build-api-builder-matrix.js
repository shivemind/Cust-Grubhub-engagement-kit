#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  if (!fs.existsSync(absolutePath)) {
    fail(`Service config not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON in ${absolutePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    fail(`Expected an object in ${absolutePath}`);
  }

  if (!Array.isArray(parsed.services)) {
    fail(`Expected "services" to be an array in ${absolutePath}`);
  }

  return parsed;
}

function parseFilter(rawFilter) {
  return String(rawFilter || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveRepoMetadata(config, service) {
  const repoOwner =
    (service.github && service.github.owner) ||
    (config.github && config.github.owner) ||
    process.env.GITHUB_REPOSITORY_OWNER ||
    '';
  const repoPrefix =
    (service.github && service.github.repo_prefix) ||
    (config.github && config.github.repo_prefix) ||
    '';
  const repoName =
    (service.github && service.github.repo_name) ||
    service.repo_name ||
    `${repoPrefix}${slugify(service.name)}`;
  const repoVisibility =
    (service.github && service.github.visibility) ||
    (config.github && config.github.visibility) ||
    'private';
  const repoDescription =
    (service.github && service.github.description) ||
    service.repo_description ||
    `${service.project_name || service.name} exported from Postman API Builder`;

  if (!repoOwner) {
    fail(
      `Missing GitHub owner for service "${service.name}". Set github.owner in ${process.env.SERVICE_CONFIG_PATH || 'config/api-builder-services.json'} or define it on the service.`
    );
  }

  if (!repoName) {
    fail(`Unable to derive repo name for service "${service.name}"`);
  }

  return {
    repo_owner: repoOwner,
    repo_name: repoName,
    repo_full_name: `${repoOwner}/${repoName}`,
    repo_visibility: repoVisibility,
    repo_description: repoDescription
  };
}

function main() {
  const configPath = process.env.SERVICE_CONFIG_PATH || 'config/api-builder-services.json';
  const serviceFilter = parseFilter(process.env.SERVICE_FILTER);
  const config = loadConfig(configPath);

  let services = config.services;
  if (serviceFilter.length > 0) {
    const wanted = new Set(serviceFilter);
    services = config.services.filter((service) => wanted.has(service.name));

    const missing = serviceFilter.filter(
      (name) => !services.some((service) => service.name === name)
    );
    if (missing.length > 0) {
      fail(`Unknown service name(s): ${missing.join(', ')}`);
    }
  }

  const matrix = services.map((service) => ({
    name: service.name,
    project_name: service.project_name || service.name,
    ...resolveRepoMetadata(config, service)
  }));

  const payload = JSON.stringify(matrix);
  const count = String(matrix.length);
  const githubOutput = process.env.GITHUB_OUTPUT;

  if (githubOutput) {
    fs.appendFileSync(githubOutput, `matrix=${payload}\n`);
    fs.appendFileSync(githubOutput, `count=${count}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ matrix, count: matrix.length }, null, 2)}\n`);
  }
}

main();
