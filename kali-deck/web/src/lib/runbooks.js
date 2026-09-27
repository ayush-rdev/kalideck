// GUI tool forms: curated command builders for the most-used tools.
// Each runbook renders fields, builds a shell command, and either runs it
// as a job (quick output) or opens it in a real terminal.
//
// `toolId` links back to catalog.json ids for install status.

const SECLISTS_WEB = '/usr/share/seclists/Discovery/Web-Content/common.txt'
const SECLISTS_DIRS = '/usr/share/seclists/Discovery/Web-Content'

const extra = {
  k: 'extra',
  label: 'Extra args',
  type: 'text',
  placeholder: 'appended as-is',
}

export const RUNBOOKS = [
  {
    id: 'nmap',
    toolId: 'nmap',
    name: 'Nmap',
    cat: 'net',
    icon: 'crosshair',
    desc: 'Port scan, service & OS fingerprinting, scripts',
    fields: [
      {
        k: 'target',
        label: 'Target',
        type: 'text',
        placeholder: '192.168.1.10, 10.0.0.0/24, example.com',
        required: true,
      },
      {
        k: 'scan',
        label: 'Scan type',
        type: 'select',
        default: '-sV -sC',
        options: [
          { v: '-sV -sC', l: 'Service + default scripts (recommended)' },
          { v: '-sS -T4', l: 'SYN scan, fast timing' },
          { v: '-F', l: 'Fast top-1000 ports' },
          { v: '-p-', l: 'All 65535 ports (slow)' },
          { v: '-sU', l: 'UDP scan' },
          { v: '--script vuln', l: 'Vulnerability scripts' },
          { v: '-sn', l: 'Ping sweep only (host discovery)' },
        ],
      },
      {
        k: 'ports',
        label: 'Ports',
        type: 'text',
        placeholder: 'e.g. 22,80,443 or 1-1024',
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['nmap', v.scan, v.ports && `-p${v.ports}`, v.extra, v.target]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'masscan',
    toolId: 'masscan',
    name: 'Masscan',
    cat: 'net',
    icon: 'activity',
    desc: 'Internet-scale fast port scanner',
    fields: [
      {
        k: 'target',
        label: 'Target',
        type: 'text',
        placeholder: '10.0.0.0/24',
        required: true,
      },
      {
        k: 'ports',
        label: 'Ports',
        type: 'text',
        default: '1-65535',
        placeholder: '1-65535 or 80,443',
      },
      {
        k: 'rate',
        label: 'Packets/sec',
        type: 'text',
        default: '1000',
        placeholder: '1000',
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['masscan', v.target, `-p${v.ports || '1-65535'}`, `--rate=${v.rate || 1000}`, v.extra]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'subfinder',
    toolId: 'subfinder',
    name: 'Subfinder',
    cat: 'net',
    icon: 'globe',
    desc: 'Passive subdomain enumeration',
    fields: [
      {
        k: 'domain',
        label: 'Domain',
        type: 'text',
        placeholder: 'example.com',
        required: true,
      },
      { k: 'silent', label: 'Silent output (one per line)', type: 'check', default: true },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['subfinder', '-d', v.domain, v.silent && '-silent', v.extra]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'httpx',
    toolId: 'httpx',
    name: 'httpx probe',
    cat: 'web',
    icon: 'activity',
    desc: 'Probe URLs for status, titles, tech, codes',
    fields: [
      {
        k: 'target',
        label: 'URL or host',
        type: 'text',
        placeholder: 'https://example.com or example.com',
        required: true,
      },
      { k: 'title', label: 'Show titles', type: 'check', default: true },
      { k: 'tech', label: 'Tech detect', type: 'check', default: true },
      { k: 'code', label: 'Status codes', type: 'check', default: true },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      [
        'printf %s',
        JSON.stringify(v.target.trim()),
        '| httpx',
        v.title && '-title',
        v.tech && '-td',
        v.code && '-sc',
        v.extra,
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'nuclei',
    toolId: 'nuclei',
    name: 'Nuclei',
    cat: 'web',
    icon: 'alert',
    desc: 'Template-driven vulnerability scanner',
    fields: [
      {
        k: 'target',
        label: 'URL / host / list',
        type: 'text',
        placeholder: 'https://example.com',
        required: true,
      },
      {
        k: 'severity',
        label: 'Severity filter',
        type: 'select',
        default: 'critical,high,medium',
        options: [
          { v: 'critical,high,medium,low', l: 'All severities' },
          { v: 'critical,high,medium', l: 'Medium and above (default)' },
          { v: 'critical,high', l: 'High + critical only' },
          { v: 'critical', l: 'Critical only' },
        ],
      },
      { k: 'headless', label: 'Headless browser templates', type: 'check', default: false },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      [
        'nuclei',
        /^https?:\/\//.test(v.target) ? '-u' : '-l',
        v.target,
        '-severity',
        v.severity,
        v.headless && '-headless',
        v.extra,
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'ffuf',
    toolId: 'ffuf',
    name: 'FFuf',
    cat: 'web',
    icon: 'crosshair',
    desc: 'Fast content discovery / fuzzing',
    fields: [
      {
        k: 'url',
        label: 'URL with FUZZ',
        type: 'text',
        placeholder: 'http://target/FUZZ',
        required: true,
      },
      {
        k: 'wordlist',
        label: 'Wordlist',
        type: 'select',
        default: SECLISTS_WEB,
        options: [
          { v: SECLISTS_WEB, l: 'SecLists common.txt (small)' },
          { v: `${SECLISTS_DIRS}/directory-list-2.3-small.txt`, l: 'directory-list-2.3-small' },
          { v: `${SECLISTS_DIRS}/directory-list-2.3-big.txt`, l: 'directory-list-2.3-big (slow)' },
          { v: '/usr/share/wordlists/dirb/common.txt', l: 'dirb common' },
        ],
      },
      {
        k: 'ext',
        label: 'Extensions',
        type: 'text',
        placeholder: 'php,html,js (optional)',
      },
      {
        k: 'threads',
        label: 'Threads',
        type: 'text',
        default: '40',
        placeholder: '40',
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      [
        'ffuf',
        '-u',
        JSON.stringify(v.url),
        '-w',
        v.wordlist,
        v.ext && `-e ${v.ext}`,
        `-t ${v.threads || 40}`,
        '-mc 200,204,301,302,307,401,403',
        v.extra,
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'gobuster',
    toolId: 'gobuster',
    name: 'Gobuster',
    cat: 'web',
    icon: 'crosshair',
    desc: 'Directory / DNS / vhost busting',
    fields: [
      {
        k: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'dir',
        options: [
          { v: 'dir', l: 'Directory mode' },
          { v: 'dns', l: 'DNS subdomain mode' },
          { v: 'vhost', l: 'Vhost mode' },
        ],
      },
      {
        k: 'url',
        label: 'URL or domain',
        type: 'text',
        placeholder: 'http://target (or domain for dns mode)',
        required: true,
      },
      {
        k: 'wordlist',
        label: 'Wordlist',
        type: 'select',
        default: SECLISTS_WEB,
        options: [
          { v: SECLISTS_WEB, l: 'SecLists common.txt' },
          { v: `${SECLISTS_DIRS}/directory-list-2.3-small.txt`, l: 'directory-list-2.3-small' },
          { v: '/usr/share/wordlists/dirb/common.txt', l: 'dirb common' },
        ],
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      [
        'gobuster',
        v.mode,
        '-u',
        v.url,
        '-w',
        v.wordlist,
        v.mode === 'dir' && '-x php,html,js,txt,bak',
        '-q',
        v.extra,
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'sqlmap',
    toolId: 'sqlmap',
    name: 'SQLMap',
    cat: 'web',
    icon: 'alert',
    desc: 'Automatic SQL injection detection & takeover',
    fields: [
      {
        k: 'url',
        label: 'URL with parameter',
        type: 'text',
        placeholder: 'http://target/page?id=1',
        required: true,
      },
      {
        k: 'data',
        label: 'POST data (optional)',
        type: 'text',
        placeholder: 'id=1&user=admin',
      },
      {
        k: 'level',
        label: 'Level',
        type: 'select',
        default: '1',
        options: [
          { v: '1', l: '1 (default)' },
          { v: '2', l: '2' },
          { v: '3', l: '3' },
          { v: '5', l: '5 (aggressive)' },
        ],
      },
      {
        k: 'risk',
        label: 'Risk',
        type: 'select',
        default: '1',
        options: [
          { v: '1', l: '1 (default)' },
          { v: '2', l: '2' },
          { v: '3', l: '3 (heavy)' },
        ],
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      [
        'sqlmap',
        '-u',
        JSON.stringify(v.url),
        v.data && `--data=${JSON.stringify(v.data)}`,
        '-level',
        v.level,
        '-risk',
        v.risk,
        '--batch',
        v.extra,
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'nikto',
    toolId: 'nikto',
    name: 'Nikto',
    cat: 'web',
    icon: 'alert',
    desc: 'Web server scanner',
    fields: [
      {
        k: 'host',
        label: 'Host',
        type: 'text',
        placeholder: 'http://target:8080',
        required: true,
      },
      { k: 'tuning', label: 'Tuning (0-9, x)', type: 'text', placeholder: 'e.g. 3 or x' },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['nikto', '-h', v.host, v.tuning && `-tuning ${v.tuning}`, v.extra]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'hydra',
    toolId: 'hydra',
    name: 'Hydra',
    cat: 'exploit',
    icon: 'lock',
    desc: 'Network login brute-force',
    fields: [
      {
        k: 'target',
        label: 'Target host',
        type: 'text',
        placeholder: '192.168.1.5',
        required: true,
      },
      {
        k: 'service',
        label: 'Service',
        type: 'select',
        default: 'ssh',
        options: [
          { v: 'ssh', l: 'ssh' },
          { v: 'ftp', l: 'ftp' },
          { v: 'http-get', l: 'http-get' },
          { v: 'https-get', l: 'https-get' },
          { v: 'smb', l: 'smb' },
          { v: 'rdp', l: 'rdp' },
          { v: 'mysql', l: 'mysql' },
          { v: 'postgresql', l: 'postgresql' },
        ],
      },
      {
        k: 'user',
        label: 'Username',
        type: 'text',
        placeholder: 'root (or use -L file in extra)',
      },
      {
        k: 'pass',
        label: 'Password',
        type: 'text',
        placeholder: 'admin (or use -P file in extra)',
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      [
        'hydra',
        v.user ? `-l ${v.user}` : '-L /usr/share/seclists/Usernames/top-usernames-shortlist.txt',
        v.pass ? `-p ${JSON.stringify(v.pass)}` : '-P /usr/share/seclists/Passwords/Common-Credentials/10k-most-common.txt',
        v.target,
        v.service,
        '-t 4',
        '-f',
        v.extra,
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'sherlock',
    toolId: 'sherlock',
    name: 'Sherlock',
    cat: 'osint',
    icon: 'search',
    desc: 'Hunt a username across social networks',
    fields: [
      {
        k: 'user',
        label: 'Username',
        type: 'text',
        placeholder: 'johndoe',
        required: true,
      },
      { k: 'printFound', label: 'Only print found accounts', type: 'check', default: true },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['sherlock', v.user, v.printFound && '--print-found', v.extra]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'maigret',
    toolId: 'maigret',
    name: 'Maigret',
    cat: 'osint',
    icon: 'search',
    desc: 'Username OSINT across 3000+ sites',
    fields: [
      {
        k: 'user',
        label: 'Username',
        type: 'text',
        placeholder: 'johndoe',
        required: true,
      },
      {
        k: 'site',
        label: 'Single site (optional)',
        type: 'text',
        placeholder: 'e.g. reddit.com',
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['maigret', v.user, v.site && `--site ${v.site}`, v.extra]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'theharvester',
    toolId: 'theharvester',
    name: 'theHarvester',
    cat: 'osint',
    icon: 'globe',
    desc: 'Emails, subdomains & names from public sources',
    fields: [
      {
        k: 'domain',
        label: 'Domain',
        type: 'text',
        placeholder: 'example.com',
        required: true,
      },
      {
        k: 'source',
        label: 'Source',
        type: 'select',
        default: 'all',
        options: [
          { v: 'all', l: 'all sources' },
          { v: 'bing', l: 'bing' },
          { v: 'duckduckgo', l: 'duckduckgo' },
          { v: 'github', l: 'github' },
          { v: 'hunter', l: 'hunter' },
          { v: 'linkedin', l: 'linkedin' },
          { v: 'virustotal', l: 'virustotal' },
        ],
      },
      {
        k: 'limit',
        label: 'Results limit',
        type: 'text',
        default: '100',
        placeholder: '100',
      },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['theHarvester', '-d', v.domain, '-b', v.source, '-l', v.limit || 100, v.extra]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'dig',
    toolId: 'dnsutils',
    name: 'DNS lookup',
    cat: 'net',
    icon: 'globe',
    desc: 'dig - DNS queries and zone data',
    fields: [
      {
        k: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'example.com',
        required: true,
      },
      {
        k: 'type',
        label: 'Record type',
        type: 'select',
        default: 'A',
        options: [
          { v: 'A', l: 'A' },
          { v: 'AAAA', l: 'AAAA' },
          { v: 'ANY', l: 'ANY' },
          { v: 'MX', l: 'MX' },
          { v: 'NS', l: 'NS' },
          { v: 'TXT', l: 'TXT' },
          { v: 'SOA', l: 'SOA' },
          { v: 'CNAME', l: 'CNAME' },
        ],
      },
      { k: 'trace', label: 'Trace delegation path', type: 'check', default: false },
      { k: 'extra', ...extra },
    ],
    build: (v) =>
      ['dig', v.trace && '+trace', v.name, v.type, v.extra]
        .filter(Boolean)
        .join(' '),
  },
]

export const runbookById = (id) => RUNBOOKS.find((r) => r.id === id)
export const runbookForTool = (toolId) => RUNBOOKS.find((r) => r.toolId === toolId)

// Default form values for a runbook.
export function defaultValues(runbook) {
  const out = {}
  for (const f of runbook.fields) {
    out[f.k] = f.default !== undefined ? f.default : f.type === 'check' ? false : ''
  }
  return out
}

// Required-field validation for a runbook.
export function missingRequired(runbook, values) {
  return runbook.fields.some((f) => f.required && !String(values[f.k] || '').trim())
}
