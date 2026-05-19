const fs = require('fs');
const path = require('path');

const rawUrl =
  process.env.OUTLINE_API_URL || 'http://host.docker.internal:3000/api';
const normalizedUrl = rawUrl.replace(/\/+$/, '');
const apiUrl = normalizedUrl.endsWith('/api')
  ? normalizedUrl
  : `${normalizedUrl}/api`;
const apiKey = process.env.OUTLINE_API_KEY;

if (!apiKey) {
  process.stdout.write('OUTLINE_API_KEY not set\n');
  process.exit(1);
}

const promptsConfigPath = path.join(
  process.cwd(),
  'config',
  'bothub',
  'config.json',
);
const mapConfigPath = path.join(
  process.cwd(),
  'config',
  'bothub',
  'outline_map.json',
);

const request = async (endpoint, body) => {
  const response = await fetch(`${apiUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    process.stdout.write(text + '\n');
    throw new Error(`Outline API error: ${response.status}`);
  }
  const json = text ? JSON.parse(text) : {};
  return json.data ?? json;
};

const migrate = async () => {
  const rawConfig = fs.readFileSync(promptsConfigPath, 'utf-8');
  const config = JSON.parse(rawConfig);
  const prompts = config.prompts;
  if (!prompts) {
    process.stdout.write('No prompts found\n');
    return;
  }

  const collections = await request('collections.list');
  let collection = collections.find((c) => c.name === 'prompts');
  if (!collection) {
    collection = await request('collections.create', {
      name: 'prompts',
      permission: 'read_write',
    });
  }

  const mapping = {};
  for (const [key, content] of Object.entries(prompts)) {
    const doc = await request('documents.create', {
      collectionId: collection.id,
      title: key,
      text: content,
      publish: true,
    });
    mapping[key] = doc.id;
  }

  fs.writeFileSync(mapConfigPath, JSON.stringify(mapping, null, 2));
  process.stdout.write('Migration completed\n');
};

migrate().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
