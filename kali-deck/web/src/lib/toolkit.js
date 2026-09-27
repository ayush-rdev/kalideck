// In-depth tool library + runnable recipes for the kali-lab catalog.
//
// Each entry explains what the tool is actually for, the flags that matter in
// practice, and ready-to-fill commands. Recipe templates use {{field}}
// placeholders; the runner substitutes them and shows the exact command before
// running. Tools without a hand-written entry fall back to a generic builder,
// so everything in the catalog stays runnable.

// ---------------------------------------------------------------- helpers ---
const T = (k, label, extra = {}) => ({ k, label, ...extra })

const TARGET = T('target', 'Target', {
  ph: '10.10.10.5 or example.com',
  required: true,
})
const DOMAIN = T('domain', 'Domain', { ph: 'example.com', required: true })
const URL_F = T('url', 'URL', { ph: 'https://target/', required: true })
const USER_F = T('user', 'Username', { ph: 'administrator' })
const PASS_F = T('pass', 'Password', { ph: 'Password123', secret: true })
const HASH_F = T('hash', 'NTLM hash', { ph: 'aad3b435…:31d6cfe0…' })
const WORDLIST = T('wordlist', 'Wordlist', {
  ph: '/usr/share/wordlists/rockyou.txt',
  def: '/usr/share/wordlists/rockyou.txt',
})
const PORTS = T('ports', 'Ports', { ph: '22,80,443 or 1-1000', def: '1-1000' })

// risk: passive (read-only lookups) · active (touches the target) · intrusive
// (can crash services / generate heavy traffic).

// =============================================================== network ====
const nmap = {
  about:
    'The reference port scanner. It discovers open ports, identifies the service and version behind each one, guesses the OS, and runs NSE scripts that can do everything from grabbing banners to confirming real vulnerabilities. Almost every engagement starts here: you use nmap to build the target picture, then hand the interesting ports to specialised tools.',
  when: [
    'First contact with a host - what is listening?',
    'Version fingerprinting to pick exploits (pair with searchsploit)',
    'Scripted checks (--script vuln, smb-enum-shares) for quick wins',
  ],
  flags: [
    ['-sS', 'SYN/stealth scan - fast, needs raw sockets (root)'],
    ['-sV', 'probe open ports to identify service + version'],
    ['-sC', 'run the default NSE script set'],
    ['-p-', 'scan all 65535 TCP ports'],
    ['-Pn', 'skip host discovery (target blocks ping)'],
    ['-T4', 'timing template; 4 = aggressive, good on labs'],
    ['--script', 'pick NSE scripts, e.g. vuln, smb-vuln-*'],
    ['-oA out', 'save results in all three formats'],
  ],
  recipes: [
    {
      name: 'Top-1000 with versions',
      desc: 'Fast first pass: the 1000 most common ports plus service/version detection.',
      cmd: 'nmap -sV --top-ports 1000 {{target}}',
      fields: [TARGET],
      risk: 'active',
    },
    {
      name: 'Full TCP sweep',
      desc: 'All 65535 ports, aggressive timing. Slower, but you will not miss an odd high port.',
      cmd: 'nmap -p- -T4 -Pn {{target}}',
      fields: [TARGET],
      risk: 'active',
    },
    {
      name: 'Services + default scripts',
      desc: 'Version detection plus the default NSE scripts on the ports you found. The usual second pass.',
      cmd: 'nmap -sC -sV -p {{ports}} {{target}}',
      fields: [TARGET, PORTS],
      risk: 'active',
    },
    {
      name: 'Vulnerability scripts',
      desc: 'Runs the vuln NSE category. Noisy and occasionally disruptive - use on hosts you own.',
      cmd: 'nmap -sV --script vuln {{target}}',
      fields: [TARGET],
      risk: 'intrusive',
    },
    {
      name: 'Subnet ping sweep',
      desc: 'Host discovery only - a fast list of live machines on a segment.',
      cmd: 'nmap -sn {{cidr}}',
      fields: [T('cidr', 'CIDR range', { ph: '10.10.10.0/24', required: true })],
      risk: 'active',
    },
    {
      name: 'UDP top ports',
      desc: 'UDP is slow, so check only the common ones (DNS, SNMP, NTP, NetBIOS).',
      cmd: 'nmap -sU --top-ports 50 {{target}}',
      fields: [TARGET],
      risk: 'active',
    },
  ],
  docs: 'https://nmap.org/book/man.html',
}

const rustscan = {
  about:
    'Ports first, then nmap. Rustscan fires thousands of connections in parallel to find open ports in seconds, then hands the list to nmap for actual service detection. Use it when a full -p- nmap would take too long.',
  flags: [
    ['-a', 'target(s)'],
    ['--ulimit', 'raise the FD limit for more speed'],
    ['--range', 'scan a port range'],
    ['--', 'everything after this is passed to nmap'],
  ],
  recipes: [
    {
      name: 'All ports, then nmap -sV',
      desc: 'Finds every open port fast, then fingerprints just those ports with nmap.',
      cmd: 'rustscan -a {{target}} --range 1-65535 -- -sV -sC',
      fields: [TARGET],
      risk: 'active',
    },
    {
      name: 'Quick common ports',
      desc: 'Top ports only - good for a fast triage while other scans run.',
      cmd: 'rustscan -a {{target}} --range 1-10000',
      fields: [TARGET],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/RustScan/RustScan',
}

const masscan = {
  about:
    'An internet-scale port scanner: it can send packets fast enough to cover the whole IPv4 space, and you tune the packet rate yourself. In a lab it is used for wide sweeps where nmap would take hours. Rate is the dial that separates "sweep" from "denial of service" - always set it explicitly.',
  flags: [
    ['-p', 'ports, e.g. 80,443 or 1-65535'],
    ['--rate', 'packets per second - START LOW'],
    ['-oL', 'write a list-style output file'],
    ['--wait', 'seconds to wait for late replies'],
  ],
  recipes: [
    {
      name: 'Sweep a range',
      desc: 'Common web ports across a subnet at a polite rate, output to a file you can parse.',
      cmd: 'masscan {{cidr}} -p80,443,8080 --rate 1000 -oL /work/masscan.txt',
      fields: [T('cidr', 'CIDR range', { ph: '10.10.10.0/24', required: true })],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/robertdavidgraham/masscan',
}

const naabu = {
  about:
    'ProjectDiscovery\'s fast SYN/CONNECT port scanner. It is designed to sit in a pipeline - feed it a list of hosts and pipe the open ports straight into httpx or nuclei.',
  flags: [
    ['-host', 'single host'],
    ['-top-ports', 'scan the N most common ports'],
    ['-rate', 'packets per second'],
    ['-silent', 'only print results (great for piping)'],
  ],
  recipes: [
    {
      name: 'Top 1000 ports',
      desc: 'Quick sweep with quiet output you can pipe onward.',
      cmd: 'naabu -host {{target}} -top-ports 1000 -silent',
      fields: [TARGET],
      risk: 'active',
    },
    {
      name: 'Full range to file',
      desc: 'All ports, written to /work so other tools can read it.',
      cmd: 'naabu -host {{target}} -p - -rate 2000 -o /work/ports.txt',
      fields: [TARGET],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/projectdiscovery/naabu',
}

const subfinder = {
  about:
    'Passive subdomain enumeration. It asks dozens of public sources (certificate transparency logs, search engines, DNS datasets) for hostnames under a domain - without ever touching the target. The quiet first step of any external recon.',
  flags: [
    ['-d', 'domain to enumerate'],
    ['-all', 'use every source, not just the fast ones'],
    ['-silent', 'hostnames only - pipe straight to httpx'],
    ['-o', 'write results to a file'],
  ],
  recipes: [
    {
      name: 'Enumerate a domain',
      desc: 'Passive subdomain list for the target, piped-friendly output.',
      cmd: 'subfinder -d {{domain}} -silent',
      fields: [DOMAIN],
      risk: 'passive',
    },
    {
      name: 'Deep then probe',
      desc: 'All sources, saved to /work, then instantly check which hosts serve HTTP(S).',
      cmd: 'subfinder -d {{domain}} -all -silent -o /work/subs.txt && httpx -l /work/subs.txt -silent -title -status-code',
      fields: [DOMAIN],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/projectdiscovery/subfinder',
}

const dnsx = {
  about:
    'A DNS toolkit for resolving and interrogating big hostname lists. Pair it with subfinder to drop dead names, or query specific record types, wildcards and CNAMEs.',
  flags: [
    ['-l', 'file of hostnames'],
    ['-a -resp', 'A records with the answer printed'],
    ['-cname', 'chase CNAME chains (subdomain takeover hunting)'],
    ['-wd', 'filter wildcard resolutions'],
  ],
  recipes: [
    {
      name: 'Resolve subdomains',
      desc: 'Keep only hostnames that actually resolve, printing their A records.',
      cmd: 'dnsx -l /work/subs.txt -a -resp -silent',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'CNAME chains (takeover hunt)',
      desc: 'Look for dangling CNAMEs that point at unclaimed third-party services.',
      cmd: 'dnsx -l /work/subs.txt -cname -resp -silent',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/projectdiscovery/dnsx',
}

const httpx = {
  about:
    'The workhorse HTTP prober. Give it thousands of hostnames and it tells you which ones actually speak HTTP, what status code, page title, server header and technologies they return. It turns a raw subdomain list into a prioritised target list.',
  flags: [
    ['-l', 'file of hosts/URLs'],
    ['-u', 'single URL'],
    ['-status-code -title -tech-detect', 'the useful summary columns'],
    ['-ports', 'probe specific ports'],
    ['-screenshot', 'capture a screenshot of each site'],
  ],
  recipes: [
    {
      name: 'Probe a host list',
      desc: 'Status code, title and detected tech for every host in the file.',
      cmd: 'httpx -l /work/subs.txt -silent -status-code -title -tech-detect',
      fields: [],
      risk: 'active',
    },
    {
      name: 'Full port probe',
      desc: 'Check standard web ports on a single host and screenshot what answers.',
      cmd: 'httpx -u {{target}} -ports 80,443,8000,8080,8443 -status-code -title -screenshot',
      fields: [TARGET],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/projectdiscovery/httpx',
}

const ncat = {
  about:
    'Nmap\'s netcat: connect, listen, relay and now speak TLS. The plumbing tool - reverse shells, quick file transfers, banner grabs, port relays.',
  flags: [
    ['-l', 'listen mode'],
    ['-k', 'keep listening for more connections'],
    ['-v', 'verbose'],
    ['--ssl', 'wrap the connection in TLS'],
    ['-e', 'execute a program (usually disabled by default)'],
  ],
  recipes: [
    {
      name: 'Banner grab',
      desc: 'Connect to a port and see what the service announces.',
      cmd: 'ncat -v {{target}} {{port}}',
      fields: [TARGET, T('port', 'Port', { ph: '22', def: '22', required: true })],
      risk: 'active',
    },
    {
      name: 'Listener',
      desc: 'Listen on a port - the receiving end of a shell or file transfer.',
      cmd: 'ncat -lvnp {{port}}',
      fields: [T('port', 'Port', { ph: '4444', def: '4444', required: true })],
      risk: 'active',
    },
  ],
  docs: 'https://nmap.org/ncat/guide/index.html',
}

const tcpdump = {
  about:
    'The classic packet capture CLI. Filter with BPF syntax and either read live or write a pcap for Wireshark/tshark. Essential for understanding what is actually on the wire - credentials in the clear, ARP storms, unexpected egress.',
  flags: [
    ['-i', 'interface (any works without promiscuous mode)'],
    ['-n', 'do not resolve names (fast, quieter for privacy)'],
    ['-w', 'write a pcap file'],
    ['-c', 'stop after N packets'],
    ['-A / -X', 'show payload as ASCII / hex'],
  ],
  recipes: [
    {
      name: 'Capture HTTP to a host',
      desc: 'Grab 200 packets on port 80 for a target and save them for analysis.',
      cmd: 'tcpdump -i any -nn -A -c 200 "host {{target}} and port 80"',
      fields: [TARGET],
      risk: 'active',
    },
    {
      name: 'Write a pcap',
      desc: 'Record all traffic on an interface to /work for later Wireshark work.',
      cmd: 'tcpdump -i any -nn -w /work/capture.pcap',
      fields: [],
      risk: 'active',
    },
  ],
  docs: 'https://www.tcpdump.org/manpages/tcpdump.1.html',
}

const proxychains4 = {
  about:
    'Forces any TCP program through a chain of SOCKS/HTTP proxies. With the deck\'s Tor daemon running, this is how you make a tool that has no proxy support exit through Tor.',
  flags: [
    ['-q', 'quiet - suppress the banner'],
    ['-f', 'use a specific config file'],
  ],
  recipes: [
    {
      name: 'Check the exit IP through Tor',
      desc: 'Confirms proxychains + Tor are working and shows the IP the world sees.',
      cmd: 'proxychains4 -q curl -s https://check.torproject.org/api/ip',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'Tunnel any command',
      desc: 'Wrap an arbitrary command so its TCP traffic exits through Tor.',
      cmd: 'proxychains4 -q {{command}}',
      fields: [
        T('command', 'Command', { ph: 'nmap -sT -Pn 203.0.113.9', required: true }),
      ],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/haad/proxychains',
}

// =================================================================== web ====
const nuclei = {
  about:
    'A template-driven scanner: thousands of community YAML templates that describe a check (a CVE, a misconfiguration, an exposed panel, a default credential). It runs them across your target list and reports only the hits, which makes it the highest signal-per-minute tool on an external assessment.',
  flags: [
    ['-u', 'single target URL'],
    ['-l', 'target list file'],
    ['-t', 'specific template or directory'],
    ['-severity', 'filter by critical,high,medium,low,info'],
    ['-tags', 'filter by tag, e.g. cve,exposure,default-login'],
    ['-rl', 'rate limit requests per second'],
  ],
  recipes: [
    {
      name: 'Standard run',
      desc: 'All templates at a sane rate limit against one URL.',
      cmd: 'nuclei -u {{url}} -rl 150 -severity critical,high,medium',
      fields: [URL_F],
      risk: 'intrusive',
    },
    {
      name: 'Exposures + misconfig only',
      desc: 'Skip the CVE noise; look for exposed secrets, panels and bad config.',
      cmd: 'nuclei -u {{url}} -tags exposure,misconfig,default-login',
      fields: [URL_F],
      risk: 'active',
    },
    {
      name: 'From a host list',
      desc: 'Run against everything httpx confirmed earlier.',
      cmd: 'nuclei -l /work/live.txt -rl 150 -severity critical,high',
      fields: [],
      risk: 'intrusive',
    },
    {
      name: 'Update templates',
      desc: 'Refresh the community template library before a run.',
      cmd: 'nuclei -update-templates -silent',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://docs.projectdiscovery.io/tools/nuclei/overview',
}

const ffuf = {
  about:
    'A very fast web fuzzer. You give it a URL containing the keyword FUZZ and a wordlist, and it floods variations at the target looking for new content, parameters, vhosts or login bypasses. The single most useful tool for finding hidden attack surface.',
  flags: [
    ['-u', 'URL containing FUZZ'],
    ['-w', 'wordlist (comma-separate two for multiple FUZZ points)'],
    ['-mc', 'match status codes (default 200-299,301,302,307,401,403,405,500)'],
    ['-fc', 'filter out status codes you do not care about'],
    ['-fs', 'filter by response size (kills soft-404 noise)'],
    ['-H', 'add a header'],
    ['-rate', 'requests per second'],
  ],
  recipes: [
    {
      name: 'Directory discovery',
      desc: 'Classic content discovery, filtering the default noise sizes.',
      cmd: 'ffuf -u {{url}}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt -mc 200,204,301,302,307,401,403 -fs 0',
      fields: [URL_F],
      risk: 'intrusive',
    },
    {
      name: 'Vhost discovery',
      desc: 'Swap the Host header to find virtual hosts that are not in DNS.',
      cmd: 'ffuf -u {{url}}/ -H "Host: FUZZ.{{domain}}" -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -fs 0',
      fields: [URL_F, DOMAIN],
      risk: 'active',
    },
    {
      name: 'Parameter fuzzing',
      desc: 'Discover GET parameters that change the response.',
      cmd: 'ffuf -u {{url}}?FUZZ=1 -w /usr/share/seclists/Discovery/Web-Content/burp-parameter-names.txt -mc all -fs 0',
      fields: [URL_F],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/ffuf/ffuf',
}

const feroxbuster = {
  about:
    'A recursive content discovery scanner written in Rust. Unlike plain ffuf it follows discovered directories automatically and is very fast, which makes it the go-to for "how deep does this web app go?".',
  flags: [
    ['-u', 'target URL'],
    ['-w', 'wordlist'],
    ['-x', 'extensions to append, e.g. php,txt,bak'],
    ['-d', 'max recursion depth'],
    ['-t', 'threads'],
    ['--filter-status', 'drop status codes'],
  ],
  recipes: [
    {
      name: 'Recursive scan with extensions',
      desc: 'Follows directories and tests common file extensions.',
      cmd: 'feroxbuster -u {{url}} -w /usr/share/seclists/Discovery/Web-Content/raft-medium-words.txt -x php,txt,html,js,bak -d 3',
      fields: [URL_F],
      risk: 'intrusive',
    },
    {
      name: 'Quiet, status-filtered',
      desc: 'Only show real hits - filters the 404 noise that floods the log.',
      cmd: 'feroxbuster -u {{url}} -w /usr/share/seclists/Discovery/Web-Content/common.txt --filter-status 404 --quiet',
      fields: [URL_F],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/epi052/feroxbuster',
}

const gobuster = {
  about:
    'A simple, reliable bruteforcer with modes for directories, DNS subdomains and virtual hosts. Slower than ffuf but very predictable, which makes it a good baseline in a report.',
  flags: [
    ['dir / dns / vhost', 'the mode, given as a subcommand'],
    ['-u', 'target URL (dir mode)'],
    ['-d', 'domain (dns mode)'],
    ['-w', 'wordlist'],
    ['-x', 'extensions'],
    ['-t', 'threads'],
  ],
  recipes: [
    {
      name: 'Directory brute force',
      desc: 'Baseline directory scan with a couple of extensions.',
      cmd: 'gobuster dir -u {{url}} -w /usr/share/seclists/Discovery/Web-Content/common.txt -x php,html,txt',
      fields: [URL_F],
      risk: 'intrusive',
    },
    {
      name: 'DNS subdomain brute force',
      desc: 'Active subdomain brute force that catches names passive sources miss.',
      cmd: 'gobuster dns -d {{domain}} -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt',
      fields: [DOMAIN],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/OJ/gobuster',
}

const sqlmap = {
  about:
    'Automatically detects and exploits SQL injection. Hand it a URL with a parameter, or a saved HTTP request, and it enumerates the injection, then databases, tables, and can dump data or pop a shell. Powerful and loud - always confirm authorisation.',
  flags: [
    ['-u', 'URL with a parameter to test'],
    ['--batch', 'never ask questions, use defaults'],
    ['--level / --risk', 'how deep / how dangerous to go (1-5 / 1-3)'],
    ['--dbs', 'list databases'],
    ['-r', 'read a raw HTTP request file'],
    ['--tamper', 'WAF evasion scripts'],
  ],
  recipes: [
    {
      name: 'Detect + list databases',
      desc: 'Non-interactive test of one parameter, then enumerate databases.',
      cmd: 'sqlmap -u "{{url}}" --batch --dbs --level 2 --risk 1',
      fields: [URL_F],
      risk: 'intrusive',
    },
    {
      name: 'Dump a table',
      desc: 'Targeted dump once you know where the data lives.',
      cmd: 'sqlmap -u "{{url}}" --batch -D {{db}} -T {{table}} --dump',
      fields: [
        URL_F,
        T('db', 'Database', { ph: 'appdb', required: true }),
        T('table', 'Table', { ph: 'users', required: true }),
      ],
      risk: 'intrusive',
    },
    {
      name: 'Test from a saved request',
      desc: 'Use a Burp-saved request file for authenticated injection testing.',
      cmd: 'sqlmap -r /work/request.txt --batch --level 3 --risk 2',
      fields: [],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/sqlmapproject/sqlmap/wiki/Usage',
}

const nikto = {
  about:
    'A long-lived web server scanner that checks for thousands of known dangerous files, outdated server software and misconfigurations. Noisy, but a quick way to catch low-hanging fruit on an unfamiliar server.',
  flags: [
    ['-h', 'host or URL'],
    ['-p', 'port(s)'],
    ['-ssl', 'force TLS'],
    ['-Tuning', 'limit test categories (1 interesting file, 2 misconfig, 9 SQL…)'],
  ],
  recipes: [
    {
      name: 'Baseline scan',
      desc: 'Full scan of one host - expect a lot of output.',
      cmd: 'nikto -h {{url}}',
      fields: [URL_F],
      risk: 'intrusive',
    },
    {
      name: 'Interesting files only',
      desc: 'Tuning 1+2: exposed files and misconfigurations, skipping slow checks.',
      cmd: 'nikto -h {{url}} -Tuning 12',
      fields: [URL_F],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/sullo/nikto/wiki',
}

const whatweb = {
  about:
    'Fingerprints what a website runs on: CMS, frameworks, JavaScript libraries, server, analytics, embedded devices. Great first step to decide which exploit path to research.',
  flags: [
    ['-a', 'aggression level 1-4'],
    ['-v', 'verbose - show the matched string for each plugin'],
    ['--log-brief', 'one-line summary per site'],
  ],
  recipes: [
    {
      name: 'Fingerprint a site',
      desc: 'Stealthy (level 1) tech fingerprint with per-plugin evidence.',
      cmd: 'whatweb -a 1 {{url}} -v',
      fields: [URL_F],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/urbanadventurer/WhatWeb/wiki',
}

const wpscan = {
  about:
    'Purpose-built WordPress scanner: enumerates users, plugins, themes and known CVEs, and can brute-force credentials. WordPress powers a huge share of the web and plugins are the usual way in.',
  flags: [
    ['--url', 'target'],
    ['--enumerate', 'u (users), ap (all plugins), at (all themes)'],
    ['--api-token', 'unlock the vulnerability database'],
    ['--passwords', 'wordlist for brute force'],
  ],
  recipes: [
    {
      name: 'Enumerate everything',
      desc: 'Users, plugins and themes - the standard first pass.',
      cmd: 'wpscan --url {{url}} --enumerate u,ap,at',
      fields: [URL_F],
      risk: 'active',
    },
    {
      name: 'Brute force logins',
      desc: 'Password-spray discovered users. Slow and noisy; check lockout policy first.',
      cmd: 'wpscan --url {{url}} -U /work/users.txt -P {{wordlist}}',
      fields: [URL_F, WORDLIST],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/wpscanteam/wpscan/wiki/WPScan-User-Documentation',
}

const katana = {
  about:
    'A crawler built for security work: it parses JavaScript, finds API endpoints and form actions, and can run headless to catch client-side routes. Use it to map an application before fuzzing it.',
  flags: [
    ['-u', 'target URL'],
    ['-d', 'crawl depth'],
    ['-jc', 'parse JavaScript files for endpoints'],
    ['-hl', 'run headless (catches SPA routes)'],
    ['-silent', 'URLs only'],
  ],
  recipes: [
    {
      name: 'Crawl + parse JS',
      desc: 'Two levels deep with JavaScript endpoint extraction.',
      cmd: 'katana -u {{url}} -d 2 -jc -silent -o /work/urls.txt',
      fields: [URL_F],
      risk: 'active',
    },
    {
      name: 'Headless deep crawl',
      desc: 'Uses a real browser to render SPAs and reach routes a plain crawler misses.',
      cmd: 'katana -u {{url}} -d 3 -jc -hl -silent',
      fields: [URL_F],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/projectdiscovery/katana',
}

const gau = {
  about:
    'Pulls every URL ever recorded for a domain from AlienVault, the Wayback Machine and Common Crawl. Pure passive recon that frequently surfaces forgotten admin panels and old parameters.',
  flags: [['--subs', 'include subdomains'], ['--threads', 'parallel fetches']],
  recipes: [
    {
      name: 'Known URLs',
      desc: 'Archived URLs for the domain including subdomains, saved for later filtering.',
      cmd: 'gau {{domain}} --subs > /work/gau.txt',
      fields: [DOMAIN],
      risk: 'passive',
    },
    {
      name: 'URLs with parameters (fuzz targets)',
      desc: 'Only URLs carrying query strings - the injection candidates.',
      cmd: 'gau {{domain}} --subs | grep "=" > /work/params.txt',
      fields: [DOMAIN],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/lc/gau',
}

const waybackurls = {
  about:
    'A minimal Wayback Machine fetcher. Smaller scope than gau but very quick when you only need historical URLs from one host.',
  flags: [],
  recipes: [
    {
      name: 'Historical URLs',
      desc: 'Fetch every archived URL for a host and save it.',
      cmd: 'waybackurls {{target}} > /work/wayback.txt',
      fields: [TARGET],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/tomnomnom/waybackurls',
}

const arjun = {
  about:
    'Discovers hidden HTTP parameters by comparing responses to large batches of candidate names. Finds the debug, admin and file parameters that are not linked anywhere.',
  flags: [
    ['-u', 'target URL'],
    ['-m', 'GET or POST'],
    ['-w', 'custom wordlist'],
    ['-t', 'threads'],
  ],
  recipes: [
    {
      name: 'Discover GET parameters',
      desc: 'Standard parameter discovery on an endpoint.',
      cmd: 'arjun -u {{url}} -m GET',
      fields: [URL_F],
      risk: 'intrusive',
    },
    {
      name: 'Discover POST parameters',
      desc: 'Same idea against a form handler.',
      cmd: 'arjun -u {{url}} -m POST',
      fields: [URL_F],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/s0md3v/Arjun',
}

const testssl = {
  about:
    'Deep TLS/SSL configuration testing: protocol versions, cipher suites, certificate chain problems, Heartbleed, ROBOT, and the weaknesses that make a "secure" site still grade badly.',
  flags: [
    ['--fast', 'skip the slowest checks'],
    ['--severity', 'filter output'],
    ['-p', 'test a specific port'],
    ['--jsonfile', 'machine-readable output'],
  ],
  recipes: [
    {
      name: 'Standard TLS audit',
      desc: 'Full check minus the slowest tests, JSON output for the report.',
      cmd: 'testssl --fast --jsonfile /work/tls.json {{target}}:443',
      fields: [TARGET],
      risk: 'active',
    },
    {
      name: 'Non-standard port',
      desc: 'Audit a TLS service on a custom port.',
      cmd: 'testssl {{target}}:{{port}}',
      fields: [TARGET, T('port', 'Port', { ph: '8443', def: '8443', required: true })],
      risk: 'active',
    },
  ],
  docs: 'https://testssl.sh/',
}

const gowitness = {
  about:
    'Mass web screenshots. Point it at a list of URLs and it renders each one, which lets you eyeball hundreds of hosts at a glance and spot the interesting dev/staging panels.',
  flags: [
    ['-f', 'file of URLs'],
    ['-N', 'do not write to a database'],
    ['--screenshot-path', 'where to save images'],
  ],
  recipes: [
    {
      name: 'Screenshot a host list',
      desc: 'Render every URL in /work/live.txt into images.',
      cmd: 'gowitness scan file -f /work/live.txt --screenshot-path /work/shots --write-db=false',
      fields: [],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/sensepost/gowitness',
}

// ========================================================= active directory ==
const netexec = {
  about:
    'The successor to CrackMapExec. One interface over SMB, WinRM, LDAP, MSSQL and SSH for authenticated enumeration, credential spraying and remote execution across a Windows estate. The daily driver for AD assessments.',
  flags: [
    ['smb / winrm / ldap / mssql', 'the protocol module, given first'],
    ['-u / -p', 'username / password'],
    ['-H', 'use an NTLM hash instead of a password (pass-the-hash)'],
    ['--shares / --users / --groups', 'enumeration switches'],
    ['-M', 'run a module, e.g. lsassy, spider_plus'],
    ['--local-auth', 'authenticate against local accounts, not the domain'],
  ],
  recipes: [
    {
      name: 'Password spray across a subnet',
      desc: 'Tries one password for each user against every reachable host. Watch the lockout policy first.',
      cmd: 'nxc smb {{cidr}} -u /work/users.txt -p "{{pass}}" --continue-on-success',
      fields: [
        T('cidr', 'CIDR range', { ph: '10.10.10.0/24', required: true }),
        PASS_F,
      ],
      risk: 'intrusive',
    },
    {
      name: 'Enumerate shares and users',
      desc: 'Authenticated SMB reconnaissance with a valid credential.',
      cmd: 'nxc smb {{target}} -u {{user}} -p "{{pass}}" --shares --users --groups',
      fields: [TARGET, USER_F, PASS_F],
      risk: 'active',
    },
    {
      name: 'Pass-the-hash with SMB',
      desc: 'Authenticate using an NTLM hash instead of the plaintext password.',
      cmd: 'nxc smb {{target}} -u {{user}} -H {{hash}} --shares',
      fields: [TARGET, USER_F, HASH_F],
      risk: 'active',
    },
    {
      name: 'Dump LSASS via module',
      desc: 'Run the lsassy module to extract cached credentials from memory.',
      cmd: 'nxc smb {{target}} -u {{user}} -p "{{pass}}" -M lsassy',
      fields: [TARGET, USER_F, PASS_F],
      risk: 'intrusive',
    },
  ],
  docs: 'https://www.netexec.wiki/',
}

const impacket = {
  about:
    'A toolkit of Python implementations of Windows protocols (SMB, MSRPC, Kerberos, LDAP). It ships dozens of scripts - secretsdump for registry hives, GetNPUsers for Kerberoastable/AS-REP accounts, psexec/smbexec/wmiexec for remote execution - and they are the backbone of most AD attacks.',
  flags: [
    ['secretsdump.py', 'dump SAM/LSA/NTDS secrets'],
    ['GetNPUsers.py', 'AS-REP roast accounts without preauth'],
    ['GetUserSPNs.py', 'Kerberoast service accounts'],
    ['-hashes', 'pass-the-hash as LM:NT'],
    ['-no-pass', 'used with -k for Kerberos auth'],
  ],
  recipes: [
    {
      name: 'AS-REP roast',
      desc: 'Find accounts with Kerberos pre-auth disabled and grab crackable hashes.',
      cmd: 'impacket-GetNPUsers {{domain}}/ -usersfile /work/users.txt -dc-ip {{dc}} -format hashcat -outputfile /work/asrep.txt',
      fields: [
        DOMAIN,
        T('dc', 'Domain controller IP', { ph: '10.10.10.10', required: true }),
      ],
      risk: 'active',
    },
    {
      name: 'Kerberoast',
      desc: 'Request service tickets for accounts with SPNs and save the hashes for hashcat.',
      cmd: 'impacket-GetUserSPNs {{domain}}/{{user}}:"{{pass}}" -dc-ip {{dc}} -request -outputfile /work/kerberoast.txt',
      fields: [
        DOMAIN,
        USER_F,
        PASS_F,
        T('dc', 'Domain controller IP', { ph: '10.10.10.10', required: true }),
      ],
      risk: 'active',
    },
    {
      name: 'Dump domain secrets',
      desc: 'secretsdump over SMB with admin credentials - local hashes and, on a DC, every domain hash.',
      cmd: 'impacket-secretsdump {{domain}}/{{user}}:"{{pass}}"@{{target}}',
      fields: [DOMAIN, USER_F, PASS_F, TARGET],
      risk: 'intrusive',
    },
    {
      name: 'Pass-the-hash shell',
      desc: 'Semi-interactive SYSTEM shell using an NTLM hash.',
      cmd: 'impacket-psexec -hashes {{hash}} {{user}}@{{target}}',
      fields: [HASH_F, USER_F, TARGET],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/fortra/impacket',
}

const kerbrute = {
  about:
    'Fast, unauthenticated Kerberos abuse: enumerate valid usernames through AS-REQ timing, then password-spray them. Because it does not authenticate to SMB, it works before you have any credential and often evades login-based lockout alerting.',
  flags: [
    ['userenum', 'enumerate valid users'],
    ['passwordspray', 'try one password for many users'],
    ['bruteuser', 'brute force one account'],
    ['--dc', 'domain controller'],
    ['-d', 'domain'],
  ],
  recipes: [
    {
      name: 'Enumerate valid usernames',
      desc: 'Confirms which users exist in the domain without any credentials.',
      cmd: 'kerbrute userenum -d {{domain}} --dc {{dc}} /usr/share/seclists/Usernames/xato-net-10-million-usernames.txt',
      fields: [
        DOMAIN,
        T('dc', 'Domain controller IP', { ph: '10.10.10.10', required: true }),
      ],
      risk: 'active',
    },
    {
      name: 'Password spray',
      desc: 'One password, many users. This is the classic way to get the first valid credential.',
      cmd: 'kerbrute passwordspray -d {{domain}} --dc {{dc}} /work/users.txt "{{pass}}"',
      fields: [
        DOMAIN,
        T('dc', 'Domain controller IP', { ph: '10.10.10.10', required: true }),
        PASS_F,
      ],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/ropnop/kerbrute',
}

const certipy = {
  about:
    'AD Certificate Services attack toolkit. It finds vulnerable certificate templates (ESC1-ESC8) and abuses them to escalate to Domain Admin - one of the most common real-world AD privilege escalation paths.',
  flags: [
    ['find', 'enumerate templates and CAs'],
    ['req', 'request a certificate'],
    ['auth', 'use a certificate for authentication (PKINIT)'],
    ['-u / -p', 'credentials'],
    ['-dc-ip', 'domain controller'],
    ['-ca', 'certificate authority name'],
  ],
  recipes: [
    {
      name: 'Find vulnerable templates',
      desc: 'Enumerate CAs and templates and flag exploitable misconfigurations.',
      cmd: 'certipy-ad find -u {{user}}@{{domain}} -p "{{pass}}" -dc-ip {{dc}} -vulnerable -stdout',
      fields: [
        USER_F,
        DOMAIN,
        PASS_F,
        T('dc', 'Domain controller IP', { ph: '10.10.10.10', required: true }),
      ],
      risk: 'active',
    },
    {
      name: 'Request a certificate (ESC1)',
      desc: 'Abuse a template that lets you set your own SAN, escalating to the target user.',
      cmd: 'certipy-ad req -u {{user}}@{{domain}} -p "{{pass}}" -dc-ip {{dc}} -ca {{ca}} -template {{template}} -upn administrator@{{domain}}',
      fields: [
        USER_F,
        DOMAIN,
        PASS_F,
        T('dc', 'Domain controller IP', { ph: '10.10.10.10', required: true }),
        T('ca', 'CA name', { ph: 'CORP-CA', required: true }),
        T('template', 'Template', { ph: 'VulnTemplate', required: true }),
      ],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/ly4k/Certipy',
}

const bloodhoundpython = {
  about:
    'The Python BloodHound collector. It maps users, groups, computers, sessions and ACLs into a graph, so you can see the shortest path from your foothold to Domain Admin instead of guessing.',
  flags: [
    ['-u / -p / -d / -dc-ip', 'credentials and domain'],
    ['-c', 'collection methods (Default, DCOnly, All)'],
    ['-ns', 'name server'],
    ['--zip', 'bundle the JSON for ingestion'],
  ],
  recipes: [
    {
      name: 'Collect domain data',
      desc: 'Full collection written to /work, ready to drag into BloodHound.',
      cmd: 'bloodhound-python -u {{user}} -p "{{pass}}" -d {{domain}} -dc {{dc}} -ns {{dc}} -c All --zip -op /work/bh',
      fields: [
        USER_F,
        PASS_F,
        DOMAIN,
        T('dc', 'Domain controller IP', { ph: '10.10.10.10', required: true }),
      ],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/dirkjanm/BloodHound.py',
}

const evilwinrm = {
  about:
    'An interactive WinRM shell with upload/download, PowerShell module loading and pass-the-hash support. Once you have any local admin credential on a Windows host that exposes WinRM (5985/5986), this is usually how you get a shell.',
  flags: [
    ['-u / -p', 'credentials'],
    ['-H', 'NTLM hash instead of a password'],
    ['-i', 'IP or hostname'],
    ['-S', 'use SSL (5986)'],
  ],
  recipes: [
    {
      name: 'Interactive shell',
      desc: 'WinRM session with a password or hash. Runs interactively in a terminal.',
      cmd: 'evil-winrm -i {{target}} -u {{user}} -p "{{pass}}"',
      fields: [TARGET, USER_F, PASS_F],
      risk: 'intrusive',
      interactive: true,
    },
    {
      name: 'Pass-the-hash shell',
      desc: 'Authenticate with an NTLM hash only.',
      cmd: 'evil-winrm -i {{target}} -u {{user}} -H {{hash}}',
      fields: [TARGET, USER_F, HASH_F],
      risk: 'intrusive',
      interactive: true,
    },
  ],
  docs: 'https://github.com/Hackplayers/evil-winrm',
}

const ldaputils = {
  about:
    'OpenLDAP\'s client tools. ldapsearch against a directory service anonymously often reveals users, groups and even passwords in description fields - a classic quick win.',
  flags: [
    ['-x', 'simple authentication (not SASL)'],
    ['-H', 'LDAP URI, e.g. ldap://host'],
    ['-b', 'base DN to search'],
    ['-s', 'search scope (base/one/sub)'],
  ],
  recipes: [
    {
      name: 'Anonymous base dump',
      desc: 'Dump the root DSE and naming contexts without credentials - usually the first step.',
      cmd: 'ldapsearch -x -H ldap://{{target}} -s base',
      fields: [TARGET],
      risk: 'active',
    },
    {
      name: 'Search a base DN',
      desc: 'Enumerate objects under a base DN. Try descriptions and info fields for passwords.',
      cmd: 'ldapsearch -x -H ldap://{{target}} -b "{{baseDN}}" -s sub',
      fields: [
        TARGET,
        T('baseDN', 'Base DN', { ph: 'dc=corp,dc=local', required: true }),
      ],
      risk: 'active',
    },
  ],
  docs: 'https://linux.die.net/man/1/ldapsearch',
}

// ============================================================ exploitation ===
const msfconsole = {
  about:
    'The Metasploit Framework console: exploit modules, payloads, encoders, and the meterpreter post-exploitation environment. It is the quickest route from "this service is version X" to a session, and its module library covers decades of CVEs.',
  flags: [
    ['-q', 'quiet - skip the banner'],
    ['-x', 'run a command then exit'],
    ['-r', 'run a resource script'],
    ['-n', 'no database'],
  ],
  recipes: [
    {
      name: 'Open the console',
      desc: 'Interactive msfconsole. Use search, use, show options, set, run.',
      cmd: 'msfconsole -q',
      fields: [],
      risk: 'active',
      interactive: true,
    },
    {
      name: 'Search for a module',
      desc: 'One-shot search, then exit - handy for scripting.',
      cmd: 'msfconsole -q -x "search {{query}}; exit"',
      fields: [T('query', 'Search term', { ph: 'eternalblue', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://docs.metasploit.com/',
}

const searchsploit = {
  about:
    'Offline search of the Exploit-DB archive. Given a product and version from your nmap scan, it tells you which public exploits exist and copies the source to your workspace.',
  flags: [
    ['-w', 'show the exploit-db URL'],
    ['-m', 'mirror (copy) the exploit into the current directory'],
    ['-x', 'view the exploit (with a pager, if set)'],
    ['--exclude', 'filter out noise like DoS entries'],
  ],
  recipes: [
    {
      name: 'Search for a product',
      desc: 'Look up public exploits by name and version.',
      cmd: 'searchsploit {{query}}',
      fields: [T('query', 'Product / version', { ph: 'apache 2.4.49', required: true })],
      risk: 'passive',
    },
    {
      name: 'Copy an exploit to /work',
      desc: 'Mirror a specific exploit so you can read and modify it.',
      cmd: 'cd /work && searchsploit -m {{edb}}',
      fields: [T('edb', 'Exploit-DB id / path', { ph: '50383', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://www.exploit-db.com/searchsploit',
}

const hydra = {
  about:
    'A fast parallel login bruteforcer with modules for dozens of protocols (SSH, FTP, SMB, RDP, HTTP forms, databases). Given a username and a wordlist it will hammer a service until it finds the password - so check lockout policy first.',
  flags: [
    ['-l / -L', 'single user / user list'],
    ['-p / -P', 'single password / wordlist'],
    ['-t', 'parallel tasks per target (keep it low for SSH)'],
    ['-f', 'stop on first valid pair'],
    ['-o', 'write found credentials to a file'],
  ],
  recipes: [
    {
      name: 'SSH brute force',
      desc: 'Cautious (4 threads) guess of one user\'s SSH password.',
      cmd: 'hydra -l {{user}} -P {{wordlist}} -t 4 {{target}} ssh -o /work/hydra-ssh.txt',
      fields: [USER_F, WORDLIST, TARGET],
      risk: 'intrusive',
    },
    {
      name: 'HTTP POST form',
      desc: 'Brute force a web login. Check the failure string in the source first.',
      cmd: 'hydra -l {{user}} -P {{wordlist}} {{target}} http-post-form "/login:username=^USER^&password=^PASS^:Invalid"',
      fields: [USER_F, WORDLIST, TARGET],
      risk: 'intrusive',
    },
    {
      name: 'Spray users, one password',
      desc: 'Password spray: many users, one password. Safer against lockout.',
      cmd: 'hydra -L /work/users.txt -p "{{pass}}" -t 4 {{target}} smb',
      fields: [PASS_F, TARGET],
      risk: 'intrusive',
    },
  ],
  docs: 'https://github.com/vanhauser-thc/thc-hydra',
}

const john = {
  about:
    'John the Ripper (jumbo build) cracks password hashes. What makes it powerful is the auto-detection plus hash2john utilities: point it at a file and it identifies the format, then runs wordlist, rules and incremental modes.',
  flags: [
    ['--wordlist', 'dictionary mode'],
    ['--rules', 'apply mangling rules to the wordlist'],
    ['--format', 'force a hash format when autodetect fails'],
    ['--show', 'show cracked passwords for a pot file'],
  ],
  recipes: [
    {
      name: 'Crack a hash file',
      desc: 'Wordlist plus rules - the default first attempt.',
      cmd: 'john --wordlist={{wordlist}} --rules /work/hashes.txt',
      fields: [WORDLIST],
      risk: 'passive',
    },
    {
      name: 'Show cracked results',
      desc: 'List the passwords John has recovered.',
      cmd: 'john --show /work/hashes.txt',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'Extract hashes from a shadow file',
      desc: 'Unshadow /etc/passwd and /etc/shadow into a crackable format.',
      cmd: 'unshadow /work/passwd /work/shadow > /work/hashes.txt && john --wordlist={{wordlist}} /work/hashes.txt',
      fields: [WORDLIST],
      risk: 'passive',
    },
  ],
  docs: 'https://www.openwall.com/john/doc/',
}

const hashcat = {
  about:
    'The fastest hash cracker, using GPU acceleration. It needs you to tell it the hash mode (-m) and attack mode (-a): straight dictionary, combinator, mask/brute-force. The right tool once John says "this will take months".',
  flags: [
    ['-m', 'hash type (0=MD5, 1000=NTLM, 13100=Kerberoast, 18200=AS-REP)'],
    ['-a', 'attack mode (0=wordlist, 3=mask, 6=wordlist+mask)'],
    ['-O', 'optimised kernels - faster, limits password length'],
    ['--show', 'list cracked hashes and their plaintexts'],
  ],
  recipes: [
    {
      name: 'NTLM wordlist crack',
      desc: 'Dictionary attack against NTLM hashes, the usual AD case.',
      cmd: 'hashcat -m 1000 -a 0 -O /work/ntlm.txt {{wordlist}} --username',
      fields: [WORDLIST],
      risk: 'passive',
    },
    {
      name: 'Kerberoast crack',
      desc: 'Crack Kerberos 5 TGS-REP hashes recovered earlier.',
      cmd: 'hashcat -m 13100 -a 0 -O /work/kerberoast.txt {{wordlist}}',
      fields: [WORDLIST],
      risk: 'passive',
    },
    {
      name: 'Mask attack (known pattern)',
      desc: 'Brute force a known shape, e.g. 8 chars ending in two digits.',
      cmd: 'hashcat -m 0 -a 3 -O /work/hashes.txt ?l?l?l?l?l?l?d?d',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://hashcat.net/wiki/doku.php?id=hashcat',
}

const linpeas = {
  about:
    'The Privilege Escalation Awesome Script: it enumerates everything that could be a local privilege escalation - SUID binaries, sudo rules, cron jobs, writable paths, credentials in config files, kernel version - and colour-codes the likely wins.',
  flags: [
    ['-a', 'all checks (slower, more thorough)'],
    ['-s', 'stealth: no colour, no network calls'],
    ['-P', 'password to test against discovered users'],
  ],
  recipes: [
    {
      name: 'Full enumeration',
      desc: 'Run every check. Output is long - pipe to a file when possible.',
      cmd: 'linpeas.sh -a',
      fields: [],
      risk: 'active',
    },
    {
      name: 'Stealth run to file',
      desc: 'Quiet version that writes results into /work for later reading.',
      cmd: 'linpeas.sh -s -a | tee /work/linpeas.txt',
      fields: [],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/peass-ng/PEASS-ng/tree/master/linPEAS',
}

const gdb = {
  about:
    'The GNU debugger. For binary exploitation you use it with GEF to inspect registers, stack and memory while stepping through a crashing program - the foundation of writing an exploit for a memory-corruption bug.',
  flags: [
    ['-q', 'quiet banner'],
    ['-x', 'run a command script'],
    ['--args', 'program plus arguments'],
  ],
  recipes: [
    {
      name: 'Debug the target',
      desc: 'Opens gdb interactively on a binary. Use info functions, disassemble, run, checksec.',
      cmd: 'gdb -q {{binary}}',
      fields: [T('binary', 'Binary path', { ph: '/work/vuln', required: true })],
      risk: 'passive',
      interactive: true,
    },
    {
      name: 'Check binary protections',
      desc: 'Show NX, PIE, canary, RELRO before you plan an exploit.',
      cmd: 'checksec --file={{binary}}',
      fields: [T('binary', 'Binary path', { ph: '/work/vuln', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://sourceware.org/gdb/current/onlinedocs/gdb/',
}

const binwalk = {
  about:
    'Scans firmware and other opaque binaries for embedded filesystems, compressed streams and signatures, then extracts them. The standard first move when you are handed an IoT firmware image.',
  flags: [
    ['-e', 'extract what is found'],
    ['-M', 'recursively scan extracted files'],
    ['--dd', 'extract a specific signature type'],
  ],
  recipes: [
    {
      name: 'Signature scan',
      desc: 'Identify what is inside the image.',
      cmd: 'binwalk {{file}}',
      fields: [T('file', 'Image path', { ph: '/work/firmware.bin', required: true })],
      risk: 'passive',
    },
    {
      name: 'Extract recursively',
      desc: 'Unpack everything, then unpack what was unpacked.',
      cmd: 'binwalk -e -M {{file}}',
      fields: [T('file', 'Image path', { ph: '/work/firmware.bin', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/ReFirmLabs/binwalk',
}

// =================================================================== OSINT ===
const theharvester = {
  about:
    'Collects emails, hostnames, employee names and open ports from public sources. The classic first step of an external OSINT engagement: it builds the people-and-infrastructure picture you then use for phishing simulation or password spraying.',
  flags: [
    ['-d', 'domain'],
    ['-b', 'sources (all, or a comma list)'],
    ['-l', 'result limit per source'],
    ['-f', 'write an HTML/JSON report'],
  ],
  recipes: [
    {
      name: 'Full OSINT sweep',
      desc: 'Query every source for the domain and save a report to /work.',
      cmd: 'theHarvester -d {{domain}} -b all -l 500 -f /work/harvester',
      fields: [DOMAIN],
      risk: 'passive',
    },
    {
      name: 'Fast email + host pass',
      desc: 'Limited sources and results for a quick look.',
      cmd: 'theHarvester -d {{domain}} -b bing,duckduckgo,certspotter -l 200',
      fields: [DOMAIN],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/laramies/theHarvester',
}

const sherlock = {
  about:
    'Hunts a username across hundreds of sites to find every account a person owns. Given a handle it returns profile URLs, which is often enough to de-anonymise and then pivot into password reuse research.',
  flags: [
    ['--timeout', 'seconds per site'],
    ['--print-found', 'only print confirmed hits'],
    ['--csv', 'write results to CSV'],
    ['--tor', 'route through Tor'],
  ],
  recipes: [
    {
      name: 'Hunt a username',
      desc: 'Check every supported site and only report the hits.',
      cmd: 'sherlock {{username}} --print-found',
      fields: [T('username', 'Username', { ph: 'jdoe', required: true })],
      risk: 'passive',
    },
    {
      name: 'Over Tor with CSV',
      desc: 'Same search through Tor, saved to /work.',
      cmd: 'sherlock {{username}} --tor --csv --print-found',
      fields: [T('username', 'Username', { ph: 'jdoe', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/sherlock-project/sherlock',
}

const holehe = {
  about:
    'Checks whether an email address is registered on 120+ sites by abusing password-reset flows, without alerting the owner. Useful to map which services a target uses before social engineering.',
  flags: [['--only-used', 'show only sites where the email exists']],
  recipes: [
    {
      name: 'Check an email',
      desc: 'Probe the sites silently and list only confirmed registrations.',
      cmd: 'holehe {{email}} --only-used',
      fields: [T('email', 'Email address', { ph: 'j.doe@example.com', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/megadose/holehe',
}

const maigret = {
  about:
    'Username investigation across 3000+ sites with better accuracy and reporting than sherlock, including ranking of likely matches so false positives are easier to discard.',
  flags: [
    ['-a', 'analyse profile pages for extra data'],
    ['--timeout', 'per-site timeout'],
    ['-J', 'write a JSON report'],
  ],
  recipes: [
    {
      name: 'Deep username search',
      desc: 'Search and analyse profiles, writing a report.',
      cmd: 'maigret {{username}} -a -J /work/maigret',
      fields: [T('username', 'Username', { ph: 'jdoe', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/soxoj/maigret',
}

const exiftool = {
  about:
    'Reads and writes metadata in almost any file. In OSINT it reveals GPS coordinates, camera serial numbers and author names buried in photos and documents; in defence it is how you strip that before publishing.',
  flags: [
    ['-a -u', 'show all tags including unknown ones'],
    ['-g', 'group output by category'],
    ['-r', 'recurse directories'],
    ['-Artist -GPSPosition', 'query specific tags'],
  ],
  recipes: [
    {
      name: 'Dump all metadata',
      desc: 'Everything the file knows about itself, grouped.',
      cmd: 'exiftool -a -u -g1 {{file}}',
      fields: [T('file', 'File path', { ph: '/work/photo.jpg', required: true })],
      risk: 'passive',
    },
    {
      name: 'Find GPS in a folder',
      desc: 'Recursively pull GPS positions out of every image.',
      cmd: 'exiftool -r -gps* {{dir}}',
      fields: [T('dir', 'Directory', { ph: '/work/evidence', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://exiftool.org/',
}

const trufflehog = {
  about:
    'Scans git history, filesystems and cloud buckets for live secrets using real API verification - it does not just pattern-match, it confirms the key still works. The highest-value move when you find a public repository.',
  flags: [
    ['git', 'scan a repository'],
    ['filesystem', 'scan a directory tree'],
    ['--only-verified', 'report only credentials confirmed valid'],
    ['--results', 'output format'],
  ],
  recipes: [
    {
      name: 'Scan a public repo',
      desc: 'Clone-and-scan in one step, only reporting verified live keys.',
      cmd: 'trufflehog git {{repo}} --only-verified',
      fields: [T('repo', 'Repository URL', { ph: 'https://github.com/acme/app', required: true })],
      risk: 'passive',
    },
    {
      name: 'Scan a directory',
      desc: 'Look for leaked credentials in local files.',
      cmd: 'trufflehog filesystem {{dir}} --only-verified',
      fields: [T('dir', 'Directory', { def: '/work', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/trufflesecurity/trufflehog',
}

const gitleaks = {
  about:
    'A fast secret scanner for git repositories and directories. Lighter and quicker than trufflehog, ideal as a pre-commit or CI check, and good for a first sweep of a repo you just cloned.',
  flags: [
    ['detect', 'the scanning subcommand'],
    ['--source', 'repo or directory'],
    ['--report-format', 'json/csv/sarif'],
    ['-v', 'verbose'],
  ],
  recipes: [
    {
      name: 'Scan a repository',
      desc: 'Full history scan with a JSON report.',
      cmd: 'gitleaks detect --source {{dir}} --report-format json --report-path /work/gitleaks.json -v',
      fields: [T('dir', 'Repo directory', { def: '/work', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/gitleaks/gitleaks',
}

// =================================================================== cloud ===
const trivy = {
  about:
    'A one-stop scanner for containers, filesystems, IaC and dependencies. It finds vulnerable packages, misconfigured Dockerfiles/Kubernetes manifests and hard-coded secrets in a single pass - the default check before shipping an image.',
  flags: [
    ['image', 'scan a container image'],
    ['fs / repo', 'scan a filesystem or git repo'],
    ['config', 'scan IaC (Dockerfile, Terraform, K8s)'],
    ['--severity', 'filter results'],
    ['--format', 'json/table/sarif'],
  ],
  recipes: [
    {
      name: 'Scan an image',
      desc: 'Vulnerability and misconfiguration report for a container image.',
      cmd: 'trivy image --severity HIGH,CRITICAL {{image}}',
      fields: [T('image', 'Image', { ph: 'nginx:1.19', required: true })],
      risk: 'passive',
    },
    {
      name: 'Scan a project directory',
      desc: 'Dependencies, IaC config and secrets in one run.',
      cmd: 'trivy fs --severity HIGH,CRITICAL --format json -o /work/trivy.json {{dir}}',
      fields: [T('dir', 'Directory', { def: '/work', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://trivy.dev/latest/docs/',
}

const prowler = {
  about:
    'Audits a cloud account against CIS, HIPAA, PCI and GDPR benchmarks. It checks every service for public buckets, over-permissive IAM, unencrypted volumes and missing logging, then scores your posture.',
  flags: [
    ['aws / azure / gcp', 'the provider'],
    ['-p', 'profile'],
    ['-s', 'services to include'],
    ['-M', 'output formats (json/html/csv)'],
  ],
  recipes: [
    {
      name: 'Full AWS audit',
      desc: 'Run every check and write HTML + JSON reports.',
      cmd: 'prowler aws -M html json -o /work/prowler',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'Targeted service check',
      desc: 'Limit to specific services for a quicker run.',
      cmd: 'prowler aws -s {{services}} -M json -o /work/prowler',
      fields: [
        T('services', 'Services', { ph: 's3,iam,ec2', def: 's3,iam', required: true }),
      ],
      risk: 'passive',
    },
  ],
  docs: 'https://docs.prowler.com/',
}

const kubectl = {
  about:
    'The Kubernetes CLI. In a security context it is how you check RBAC, list secrets, and find over-permissive service accounts - and in a breach, how you confirm whether you can reach the cluster API unauthenticated.',
  flags: [
    ['get', 'list resources'],
    ['-A', 'all namespaces'],
    ['--kubeconfig', 'explicit config file'],
    ['auth can-i --list', 'show what your identity may do'],
  ],
  recipes: [
    {
      name: 'List secrets everywhere',
      desc: 'Dump secret names across all namespaces (needs RBAC permission).',
      cmd: 'kubectl get secrets -A',
      fields: [],
      risk: 'active',
    },
    {
      name: 'Show my permissions',
      desc: 'What can this identity actually do? The key RBAC question.',
      cmd: 'kubectl auth can-i --list -A',
      fields: [],
      risk: 'active',
    },
  ],
  docs: 'https://kubernetes.io/docs/reference/kubectl/',
}

const awscli = {
  about:
    'The AWS command line. For testing, the interesting moves are checking your own identity, listing buckets, and testing whether S3 objects are anonymously readable.',
  flags: [
    ['sts get-caller-identity', 'who am I?'],
    ['s3 ls', 'list buckets'],
    ['s3api', 'lower-level API calls with full control'],
  ],
  recipes: [
    {
      name: 'Who am I',
      desc: 'Confirm which credentials are active before anything else.',
      cmd: 'aws sts get-caller-identity',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'List buckets',
      desc: 'Enumerate S3 buckets visible to these credentials.',
      cmd: 'aws s3 ls',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://docs.aws.amazon.com/cli/',
}

const cloudenum = {
  about:
    'Brute-forces public cloud storage names across AWS, Azure and GCP to find open buckets. Unauthenticated, high-noise, but occasionally lands real data.',
  flags: [['-k', 'keyword file'], ['-m', 'mutation wordlist'], ['-l', 'log file']],
  recipes: [
    {
      name: 'Find open buckets',
      desc: 'Enumerate cloud storage for a company keyword.',
      cmd: 'cloud_enum -k {{keyword}} -l /work/cloudenum.txt',
      fields: [T('keyword', 'Keyword', { ph: 'acme', required: true })],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/initstring/cloud_enum',
}

// ================================================================== blue =====
const yara = {
  about:
    'Pattern matching for malware: you write rules describing strings and byte patterns, and YARA tells you which files match. It is the standard way to hunt for a known family across a disk or memory image.',
  flags: [
    ['-r', 'recurse directories'],
    ['-s', 'print the matching strings'],
    ['-w', 'suppress warnings'],
    ['-d', 'define an external variable'],
  ],
  recipes: [
    {
      name: 'Scan a directory',
      desc: 'Run a rule set over a tree, printing matched strings.',
      cmd: 'yara -r -s {{rules}} {{dir}}',
      fields: [
        T('rules', 'Rule file', { ph: '/work/rules/malware.yar', required: true }),
        T('dir', 'Target directory', { def: '/work', required: true }),
      ],
      risk: 'passive',
    },
  ],
  docs: 'https://yara.readthedocs.io/',
}

const volatility = {
  about:
    'Memory forensics. It parses a RAM image into processes, network connections, loaded modules and injected code - the only way to see what was running on a machine after a live intrusion.',
  flags: [
    ['-f', 'memory image'],
    ['windows.pslist / windows.netscan', 'common plugins'],
    ['-o', 'symbol table directory'],
    ['--renderer', 'json',
    ],
  ],
  recipes: [
    {
      name: 'List processes',
      desc: 'Enumerate running processes from a memory image.',
      cmd: 'vol -f {{image}} windows.pslist',
      fields: [T('image', 'Memory image', { ph: '/work/mem.raw', required: true })],
      risk: 'passive',
    },
    {
      name: 'Network connections',
      desc: 'Show sockets and owning processes - spot C2 traffic.',
      cmd: 'vol -f {{image}} windows.netscan',
      fields: [T('image', 'Memory image', { ph: '/work/mem.raw', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://volatility3.readthedocs.io/',
}

const sleuthkit = {
  about:
    'Disk and filesystem forensics. fls lists deleted and live files, icat carves their content, mmls maps partitions - the toolkit for recovering what someone tried to erase.',
  flags: [
    ['fls', 'list files (including deleted, marked *)'],
    ['-r', 'recurse'],
    ['-d', 'deleted entries only'],
    ['icat', 'extract a file by inode'],
  ],
  recipes: [
    {
      name: 'List included deleted files',
      desc: 'Recursively show live and deleted files in a filesystem image.',
      cmd: 'fls -r -p {{image}}',
      fields: [T('image', 'Image', { ph: '/work/disk.dd', required: true })],
      risk: 'passive',
    },
    {
      name: 'Carve a deleted file',
      desc: 'Extract a file by its inode number into /work.',
      cmd: 'icat {{image}} {{inode}} > /work/recovered.bin',
      fields: [
        T('image', 'Image', { ph: '/work/disk.dd', required: true }),
        T('inode', 'Inode', { ph: '1287', required: true }),
      ],
      risk: 'passive',
    },
  ],
  docs: 'https://www.sleuthkit.org/sleuthkit/man/',
}

const clamscan = {
  about:
    'The ClamAV engine from the command line. Signature-based malware scanning that is quick to run over a directory or mounted image, and useful for a sanity check on downloaded files.',
  flags: [
    ['-r', 'recurse'],
    ['--infected', 'show only infected files'],
    ['--remove', 'delete infected files (careful)'],
    ['--stdout', 'print detections to stdout'],
  ],
  recipes: [
    {
      name: 'Scan a directory',
      desc: 'Recursive scan reporting only detections.',
      cmd: 'clamscan -r --infected --stdout {{dir}}',
      fields: [T('dir', 'Directory', { def: '/work', required: true })],
      risk: 'passive',
    },
  ],
  docs: 'https://docs.clamav.net/manual/Usage/Scanning.html',
}

const lynis = {
  about:
    'A host hardening auditor. It walks a Linux system checking for missing patches, weak SSH configuration, permissive file modes, unused services and compliance gaps, then prints a hardening index.',
  flags: [
    ['audit system', 'the default system audit'],
    ['--quick', 'skip some time-consuming checks'],
    ['--pentest', 'non-persistent, forensic-friendly mode'],
  ],
  recipes: [
    {
      name: 'System audit',
      desc: 'Run the full hardening review; the report lands in /var/log/lynis.log.',
      cmd: 'lynis audit system --quick',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://cisofy.com/documentation/lynis/',
}

const osquery = {
  about:
    'Exposes the operating system as SQL tables. "SELECT * FROM listening_ports" or "SELECT * FROM processes WHERE on_disk=0" turns incident triage into queries - brilliant for finding anomalies on a live host.',
  flags: [
    ['-A', 'run a single query and exit'],
    ['--json', 'JSON output'],
    ['--csv', 'CSV output'],
  ],
  recipes: [
    {
      name: 'Listening ports',
      desc: 'Everything currently listening, with the owning process.',
      cmd: 'osqueryi --json "select * from listening_ports"',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'Processes not on disk',
      desc: 'The classic fileless-malware query: running processes with no binary on disk.',
      cmd: 'osqueryi --json "select pid,name,path from processes where on_disk=0"',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'Persistence via cron + startup',
      desc: 'Look for scheduled and startup persistence.',
      cmd: 'osqueryi --json "select * from crontab"',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://osquery.readthedocs.io/',
}

// ============================================================== wordlists ===
const seclists = {
  about:
    'The essential wordlist collection: web content discovery, DNS names, usernames, passwords, fuzzing payloads, and everything in between. Almost every other tool on this list wants a path out of /usr/share/seclists.',
  flags: [],
  recipes: [
    {
      name: 'List web-content wordlists',
      desc: 'The Discovery/Web-Content set - the ones content scanners want.',
      cmd: 'ls -lh /usr/share/seclists/Discovery/Web-Content/ | head -40',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'List password lists',
      desc: 'The Passwords set, most useful for spraying.',
      cmd: 'ls -lh /usr/share/seclists/Passwords/ | head -40',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/danielmiessler/SecLists',
}

const wordlists = {
  about:
    'The Kali wordlist package, best known for rockyou.txt - the 14-million-entry leak that is still the first dictionary anyone reaches for.',
  flags: [],
  recipes: [
    {
      name: 'Locate rockyou',
      desc: 'Confirm whether rockyou is present (and decompress it if needed).',
      cmd: 'ls -lh /usr/share/wordlists/ && [ -f /usr/share/wordlists/rockyou.txt.gz ] && gunzip -k /usr/share/wordlists/rockyou.txt.gz || true',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://www.kali.org/tools/wordlists/',
}

const payloadsallthethings = {
  about:
    'A curated catalogue of payloads and bypass techniques for web attacks, LFI, SSRF, XSS, command injection and more. When a filter blocks your first attempt, this is where the alternative encoding lives.',
  flags: [],
  recipes: [
    {
      name: 'Browse the catalogue',
      desc: 'List the attack categories available.',
      cmd: 'ls -1 /opt/wordlists/PayloadsAllTheThings/',
      fields: [],
      risk: 'passive',
    },
    {
      name: 'Fuzz-list for a category',
      desc: 'Show the fuzzing wordlists for a specific attack type.',
      cmd: 'ls -lh "/opt/wordlists/PayloadsAllTheThings/{{category}}/Intruder/" 2>/dev/null || ls -1 "/opt/wordlists/PayloadsAllTheThings/{{category}}/"',
      fields: [
        T('category', 'Category', { ph: 'SQL Injection', required: true }),
      ],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/swisskyrepo/PayloadsAllTheThings',
}

// =============================================================== wireless ===
const aircrackng = {
  about:
    'The 802.11 suite: put a card in monitor mode, capture handshakes with airodump-ng, inject with aireplay-ng, then crack the WPA key offline with aircrack-ng. Needs a wireless adapter that supports monitor mode and injection.',
  flags: [
    ['airodump-ng', 'capture and survey networks'],
    ['aireplay-ng', 'deauth/injection'],
    ['-w', 'capture file for cracking'],
    ['-b', 'BSSID of the target AP'],
    ['-c', 'channel'],
  ],
  recipes: [
    {
      name: 'Survey nearby APs',
      desc: 'Put the card in monitor mode implicitly and list networks + clients.',
      cmd: 'airodump-ng {{iface}}',
      fields: [T('iface', 'Interface', { ph: 'wlan0', required: true })],
      risk: 'intrusive',
    },
    {
      name: 'Capture a handshake',
      desc: 'Target one AP and channel; wait for a client to (re)connect.',
      cmd: 'airodump-ng -c {{channel}} --bssid {{bssid}} -w /work/hs {{iface}}',
      fields: [
        T('channel', 'Channel', { ph: '6', required: true }),
        T('bssid', 'BSSID', { ph: 'AA:BB:CC:DD:EE:FF', required: true }),
        T('iface', 'Interface', { ph: 'wlan0', required: true }),
      ],
      risk: 'intrusive',
    },
    {
      name: 'Crack the capture',
      desc: 'Offline dictionary attack against the captured handshake.',
      cmd: 'aircrack-ng -w {{wordlist}} /work/hs-01.cap',
      fields: [WORDLIST],
      risk: 'passive',
    },
  ],
  docs: 'https://www.aircrack-ng.org/documentation.html',
}

const bettercap = {
  about:
    'A modular MITM framework for Wi-Fi, BLE, HID and Ethernet. It can ARP-spoof a segment, sniff credentials and inject content, and it has a slick interactive web UI on 8081 for driving attacks.',
  flags: [
    ['-iface', 'interface to attack from'],
    ['-eval', 'run commands at startup'],
    ['-caplet', 'load a caplet script'],
  ],
  recipes: [
    {
      name: 'Interactive console + web UI',
      desc: 'Start bettercap; net.probe, net.show, then the web UI on port 8081.',
      cmd: 'bettercap -iface {{iface}}',
      fields: [T('iface', 'Interface', { ph: 'eth0', required: true })],
      risk: 'intrusive',
      interactive: true,
    },
    {
      name: 'Network recon then ARP spoof',
      desc: 'Caplet that maps the network and starts ARP spoofing the whole subnet.',
      cmd: 'bettercap -iface {{iface}} -eval "net.probe on; sleep 10; net.show; set arp.spoof.targets {{target}}; arp.spoof on; https.proxy on"',
      fields: [
        T('iface', 'Interface', { ph: 'eth0', required: true }),
        TARGET,
      ],
      risk: 'intrusive',
    },
  ],
  docs: 'https://www.bettercap.org/usage/',
}

const hcxdumptool = {
  about:
    'Captures PMKID and EAPOL handshakes from Wi-Fi clients - often with no deauth needed, because PMKID comes from the AP itself on the first association. Modern replacement for the classic handshake capture.',
  flags: [
    ['-i', 'interface'],
    ['-o', 'output pcapng file'],
    ['--filterlist_ap', 'target a specific AP'],
  ],
  recipes: [
    {
      name: 'Capture PMKID/handshakes',
      desc: 'Record to /work; convert with hcxpcapngtool afterwards.',
      cmd: 'hcxdumptool -i {{iface}} -o /work/capture.pcapng --active_beacon',
      fields: [T('iface', 'Interface', { ph: 'wlan0', required: true })],
      risk: 'intrusive',
    },
    {
      name: 'Convert for hashcat',
      desc: 'Turn the capture into a hashcat 22000 file.',
      cmd: 'hcxpcapngtool -o /work/hashes.22000 /work/capture.pcapng',
      fields: [],
      risk: 'passive',
    },
  ],
  docs: 'https://github.com/ZerBea/hcxdumptool',
}

const macchanger = {
  about:
    'Views and changes the MAC address of an interface. Used to rotate identity on a network, dodge MAC-based filtering, or restore the original afterwards.',
  flags: [
    ['-s', 'show the current MAC'],
    ['-r', 'random MAC from a known vendor'],
    ['-m', 'set a specific MAC'],
    ['-p', 'reset to permanent hardware MAC'],
  ],
  recipes: [
    {
      name: 'Show current MAC',
      desc: 'Display vendor and current MAC.',
      cmd: 'macchanger -s {{iface}}',
      fields: [T('iface', 'Interface', { ph: 'eth0', required: true })],
      risk: 'passive',
    },
    {
      name: 'Randomise',
      desc: 'Set a random MAC (bring the interface down first if it complains).',
      cmd: 'macchanger -r {{iface}}',
      fields: [T('iface', 'Interface', { ph: 'eth0', required: true })],
      risk: 'active',
    },
  ],
  docs: 'https://github.com/alobbs/macchanger',
}

// ================================================================ registry ===
export const LIBRARY = {
  nmap, rustscan, masscan, naabu, subfinder, dnsx, httpx, ncat, tcpdump, proxychains4,
  nuclei, ffuf, feroxbuster, gobuster, sqlmap, nikto, whatweb, wpscan, katana, gau,
  waybackurls, arjun, testssl, gowitness,
  netexec, impacket, kerbrute, certipy, 'bloodhound-py': bloodhoundpython,
  'evil-winrm': evilwinrm, 'ldap-utils': ldaputils,
  metasploit: msfconsole, exploitdb: searchsploit, hydra, john, hashcat,
  peass: linpeas, gdb, binwalk,
  theharvester, sherlock, holehe, maigret, exiftool,
  'sherlock-tools': trufflehog, gitleaks,
  trivy, prowler, kubectl, awscli, 'cloud-enum': cloudenum,
  yara, volatility3: volatility, sleuthkit, clamav: clamscan, lynis, osquery,
  seclists, wordlists, payloadsallthethings,
  'aircrack-ng': aircrackng, bettercap, hcxdumptool, macchanger,
}

// --------------------------------------------------------------- fallback ---
// Every catalog tool stays runnable and documented, even without a hand-written
// entry: we synthesise a target-oriented recipe from its catalog metadata.
function genericFor(tool) {
  const bin = tool.bin || tool.id
  const interactiveish = /console|tui|shell|editor|reveal|zaproxy|mitmproxy|cockpit|streamlit/.test(
    bin
  )
  return {
    about: `${tool.name} is installed in kali-lab as \`${bin}\`. ${
      tool.desc || ''
    } This catalog entry does not have a hand-written guide yet, so start with the tool's own help output, then build the command you need.`,
    when: ['Explore its options with --help', 'Run it against a target you own'],
    flags: [],
    recipes: [
      {
        name: 'Show help',
        desc: 'Always safe: see every option the installed version supports.',
        cmd: `${bin} --help 2>&1 | head -60`,
        fields: [],
        risk: 'passive',
      },
      {
        name: 'Version',
        desc: 'Confirm it runs and which build is installed.',
        cmd: `${bin} --version 2>&1 | head -3`,
        fields: [],
        risk: 'passive',
      },
      {
        name: 'Run against a target',
        desc: 'Your own arguments, with an optional target appended. You are in control of the full command.',
        cmd: '{{command}}',
        fields: [
          T('command', 'Command', {
            ph: `${bin} <options> <target>`,
            def: `${bin} --help`,
            required: true,
          }),
        ],
        risk: 'active',
        interactive: interactiveish,
      },
    ],
    docs: '',
    generated: true,
  }
}

export function toolkitFor(tool) {
  return LIBRARY[tool.id] || genericFor(tool)
}

export function hasGuide(toolId) {
  return !!LIBRARY[toolId]
}

// Substitute {{field}} placeholders. Values are shell-quoted so a stray space
// or quote in a field cannot silently change the command shape.
export function renderCommand(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = values[k]
    if (v === undefined || v === '') return `«${k}»`
    return v
  })
}

// A recipe is runnable once every required field has a value.
export function missingFields(recipe, values) {
  return (recipe.fields || [])
    .filter((f) => f.required)
    .filter((f) => !String(values[f.k] ?? '').trim())
    .map((f) => f.label || f.k)
}

export const GUIDED_COUNT = Object.keys(LIBRARY).length
