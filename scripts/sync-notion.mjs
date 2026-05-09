import { mkdir, writeFile } from 'node:fs/promises';

const DB_ID = process.env.NOTION_DATABASE_ID || '21f45e0a73f88047abb9c8da0d353c9e';
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const OUTPUT_PATH = 'data/bilans.json';

const TITLE_PROP_NAMES = ['Bilan', 'Nom', 'Adhérent', 'Adherent'];
const DETAIL_PROP_NAMES = ['Unnamed: 1', 'Prénom', 'Prenom'];
const DATE_PROP_NAMES = ['Date', 'Dernier bilan', 'Date bilan'];
const STATUS_PROP_NAMES = ['Statut', 'Status', 'État', 'Etat'];
const FREQUENCY_PROP_NAMES = [
  'Fréquence bilan',
  'Frequence bilan',
  'Fréquence',
  'Frequence',
  'Périodicité',
  'Periodicite',
  'Intervalle'
];

if (!NOTION_TOKEN) {
  throw new Error('La variable NOTION_TOKEN est manquante.');
}

async function queryAllPages() {
  const results = [];
  let hasMore = true;
  let cursor;

  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Notion ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    results.push(...(data.results || []));
    hasMore = Boolean(data.has_more);
    cursor = data.next_cursor;
  }

  return results;
}

function findProperty(props, candidates) {
  for (const name of candidates) {
    if (props[name]) return props[name];
  }
  return null;
}

function extractPlainText(prop) {
  if (!prop) return '';

  if (prop.type === 'title') {
    return prop.title.map(item => item.plain_text).join('').trim();
  }

  if (prop.type === 'rich_text') {
    return prop.rich_text.map(item => item.plain_text).join('').trim();
  }

  if (prop.type === 'select') {
    return prop.select?.name || '';
  }

  if (prop.type === 'status') {
    return prop.status?.name || '';
  }

  if (prop.type === 'multi_select') {
    return prop.multi_select?.map(item => item.name).join(', ') || '';
  }

  if (prop.type === 'number') {
    return prop.number != null ? String(prop.number) : '';
  }

  if (prop.type === 'date') {
    return prop.date?.start || '';
  }

  if (prop.type === 'formula') {
    const formula = prop.formula;
    if (formula?.type === 'string') return formula.string || '';
    if (formula?.type === 'number' && formula.number != null) return String(formula.number);
    if (formula?.type === 'date') return formula.date?.start || '';
  }

  return '';
}

function extractDate(prop) {
  if (!prop) return null;

  if (prop.type === 'date') {
    return prop.date?.start || null;
  }

  if (prop.type === 'formula' && prop.formula?.type === 'date') {
    return prop.formula.date?.start || null;
  }

  const raw = extractPlainText(prop);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw : null;
}

function parseBilanNumber(raw) {
  if (raw == null) return null;

  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value.includes('1er bilan')) return 1;

  const match = value.match(/bilan\s*(\d+)/i);
  if (!match) return null;

  const number = parseInt(match[1], 10);
  return Number.isFinite(number) ? number : null;
}

function looksLikeBilanLabel(raw) {
  if (raw == null) return false;
  return /bilan/i.test(String(raw)) || parseBilanNumber(raw) != null;
}

function parseFrequency(raw) {
  if (raw == null) return null;

  const value = String(raw).trim().toLowerCase();
  if (!value) return null;

  if (value.includes('mensu')) return 1;
  if (value.includes('bimes')) return 2;

  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;

  const months = Math.round(parseFloat(match[1].replace(',', '.')));
  return months > 0 ? months : null;
}

function inferFrequencyFromBilan(raw) {
  const number = parseBilanNumber(raw);
  if (number == null) return null;
  return number <= 1 ? 1 : 2;
}

function buildDisplayName(nom, prenom) {
  const combined = [prenom, nom].filter(Boolean).join(' ').trim();
  return combined || nom || prenom || '—';
}

function normalizeMemberKey(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function keepLatestBilanPerPerson(bilans) {
  const latestByPerson = new Map();

  for (const bilan of bilans) {
    const key = normalizeMemberKey(bilan.displayName);
    if (!key) continue;

    const existing = latestByPerson.get(key);
    if (!existing || new Date(bilan.date) > new Date(existing.date)) {
      latestByPerson.set(key, bilan);
    }
  }

  return Array.from(latestByPerson.values()).sort((a, b) => {
    return new Date(a.date) - new Date(b.date);
  });
}

function mapPageToMember(page) {
  const props = page.properties || {};
  const nomRaw = extractPlainText(findProperty(props, TITLE_PROP_NAMES));
  const detailRaw = extractPlainText(findProperty(props, DETAIL_PROP_NAMES));
  const dateRaw = extractDate(findProperty(props, DATE_PROP_NAMES));
  const statut = extractPlainText(findProperty(props, STATUS_PROP_NAMES));
  const freqProp = extractPlainText(findProperty(props, FREQUENCY_PROP_NAMES));
  const explicitFreq = parseFrequency(freqProp);
  const bilanLabel = looksLikeBilanLabel(detailRaw) ? detailRaw : '';
  const prenomRaw = bilanLabel ? '' : detailRaw;
  const displayName = buildDisplayName(nomRaw, prenomRaw);
  const inferredFreq = inferFrequencyFromBilan(bilanLabel) || inferFrequencyFromBilan(statut);
  const intervalMonths = explicitFreq || inferredFreq || 2;
  const frequencySource = explicitFreq ? 'explicit' : inferredFreq ? 'inferred' : 'fallback';

  return {
    nom: nomRaw,
    prenom: prenomRaw,
    displayName,
    date: dateRaw,
    statut,
    url: page.url || '',
    bilanLabel,
    intervalMonths,
    frequencySource
  };
}

const pages = await queryAllPages();
const members = keepLatestBilanPerPerson(
  pages
    .map(mapPageToMember)
    .filter(member => member.date)
);

const payload = {
  generatedAt: new Date().toISOString(),
  databaseId: DB_ID,
  pageCount: pages.length,
  memberCount: members.length,
  members
};

await mkdir('data', { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`Synchro OK: ${members.length} adhérent(s) dans ${OUTPUT_PATH}`);
