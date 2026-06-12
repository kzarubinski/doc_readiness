'use strict';

const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'TS_Expert_Analysis.html');
const JSON_PATH = path.join(__dirname, 'ts_full_report.json');

const r = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
let html = fs.readFileSync(HTML, 'utf8');

const fsTs = r.overall.fs.ts;
const fsNts = r.overall.fs.nts;
const ttlaTs = r.overall.ttla.ts;
const ttlaNts = r.overall.ttla.nts;
const m = r.mixAppendix.fs;
const tm = r.mixAppendix.ttla;
const ta = r.triageAllPL;

function gap(a, b) { return Math.round((a - b) * 100) / 100; }

function fmtGap(a, b) {
  const g = gap(a, b);
  return g > 0 ? `+${g}` : String(g);
}

function replaceMixTbody(afterHeaderSnippet, newRows) {
  const idx = html.indexOf(afterHeaderSnippet);
  if (idx === -1) {
    console.warn('WARN: header not found:', afterHeaderSnippet.slice(0, 80));
    return;
  }
  const tbodyStart = html.indexOf('<tbody>', idx);
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart);
  if (tbodyStart === -1 || tbodyEnd === -1) return;
  html = html.slice(0, tbodyStart + 7) + '\n' + newRows + '\n' + html.slice(tbodyEnd);
}

// Remove Section 6 TOC link
html = html.replace(/<li><a href="#conclusions">Conclusions &amp; Key Takeaways<\/a><\/li>\s*\n/, '');

// Forecast group table (section 3c)
if (r.html.forecastGroup) {
  replaceMixTbody('<strong>FS tNPS &amp; IR by Forecast Group Category — TS vs Non-TS</strong>', r.html.forecastGroup);
  html = html.replace(
    /Volume based on tnps_denominator \(number of surveys\)\. % of Volume is calculated separately for TS \(total [^)]+\) and Non-TS \(total [^)]+\)\./,
    `Volume based on tnps_denominator (number of surveys). % of Volume is calculated separately for TS (total ${r.totals.tsSurveys.toLocaleString('en-US')}) and Non-TS (total ${r.totals.ntsSurveys.toLocaleString('en-US')}).`
  );
}

// Fix PL1 HC callout narrative
html = html.replace(
  /SKU &times; customer-type mix on HC explains <strong>6\.08 pts<\/strong> of additional gap beyond the raw &minus;18\.28 deficit;/,
  'After SKU &times; customer-type adjustment, the HC gap widens from &minus;18.28 to &minus;24.36 (mix effect &minus;6.08);'
);

// Mix tables — section 5, appendix, summary
replaceMixTbody('<strong>FS Mix-Adjusted Summary — PL1 New Hires</strong>', r.html.pl1FsMix);
replaceMixTbody('<strong>TTLA Mix-Adjusted Summary — PL1 New Hires</strong>', r.html.pl1TtlaMix);
replaceMixTbody('<strong>FS Mix-Adjusted Summary — PL1 New Hires, TRIAGE + AMEND</strong>', r.html.pl1TriageMix);
replaceMixTbody('<strong>FS Mix-Adjusted Summary — PL1 New Hires, NON TRIAGE</strong>', r.html.pl1NonTriageMix);
replaceMixTbody('<h3 id="a1-fs-mix">A1. FS — Mix-Adjusted Performance</h3>', r.html.fsMixAppendix);
replaceMixTbody('<h3 id="a2-ttla-mix">A2. TTLA — Mix-Adjusted Performance</h3>', r.html.ttlaMixAppendix);
replaceMixTbody('<h3>TTLA &mdash; Mix-Adjusted Performance</h3>', r.html.ttlaMixAppendix);

// Summary CST mix row
replaceMixTbody('<strong>FS CST — Mix-Adjusted Summary</strong>',
  `<tr><td><strong>CST</strong></td><td>${m.cst.actual}</td><td>${m.cst.adj}</td><td>${m.cst.nts}</td><td class="better">&minus;${Math.abs(m.cst.rawGap)}</td><td class="worse">${m.cst.adjGap > 0 ? '+' : ''}${m.cst.adjGap}</td><td>${m.cst.mixEffect > 0 ? '+' : ''}${m.cst.mixEffect}</td><td>SKU &times; CustType</td></tr>`);

// Summary triage tNPS table
const allTnps = m.tnps;
replaceMixTbody('<strong>FS tNPS Mix-Adjusted by SKU &mdash; Triage vs Non-Triage</strong>',
  `<tr><td><strong>TRIAGE + AMEND</strong></td><td>${ta.triage.actual}</td><td>${ta.triage.adj}</td><td>${ta.triage.nts}</td><td class="worse">${ta.triage.rawGap}</td><td class="worse">${ta.triage.adjGap}</td><td>${ta.triage.mixEffect > 0 ? '+' : ''}${ta.triage.mixEffect}</td></tr>\n` +
  `<tr><td><strong>NON TRIAGE</strong></td><td>${ta.nonTriage.actual}</td><td>${ta.nonTriage.adj}</td><td>${ta.nonTriage.nts}</td><td class="better">${ta.nonTriage.rawGap > 0 ? '+' : ''}${ta.nonTriage.rawGap}</td><td class="worse">${ta.nonTriage.adjGap}</td><td>${ta.nonTriage.mixEffect}</td></tr>\n` +
  `<tr><td><strong>ALL</strong></td><td>${allTnps.actual}</td><td>${allTnps.adj}</td><td>${allTnps.nts}</td><td class="worse">${allTnps.rawGap}</td><td class="worse">${allTnps.adjGap}</td><td>${allTnps.mixEffect}</td></tr>`);

// Fix PL1 HC callout duplicate text
html = html.replace(
  /the <strong>&minus;24\.36 pt adjusted deficit<\/strong> confirms Handle Conversion remains a genuine performance issue &mdash; Handle Conversion is still a genuine performance issue for PL1 New Hire Tax Specialists\./,
  'the <strong>&minus;24.36 pt adjusted deficit</strong> confirms Handle Conversion remains a genuine performance issue for PL1 New Hire Tax Specialists.'
);

// TTLA PL1 mix callout — add SQS mention
html = html.replace(
  /IR advantage also holds after customer-type adjustment \(\+4\.38 &rarr; \+4\.49\)\. TS outperformance on TTLA among PL1 New Hires is genuine/,
  `IR (+4.38 &rarr; +4.49) and SQS (+2.11 &rarr; +2.19) advantages also hold after mix adjustment. TS outperformance on TTLA among PL1 New Hires is genuine`
);

// Summary TTLA key finding paragraph
html = html.replace(
  /<p><strong>TTLA Key Finding:<\/strong> Mix-adjustment confirms and slightly strengthens TS's TTLA advantage\. The tNPS gap increases from \+2\.71 to \+3\.06 after adjustment, and the AHT gap narrows from \+1\.66 to \+1\.32 minutes\. The IR advantage is virtually unchanged\. TS's TTLA outperformance is genuine and not a composition artifact\.<\/p>/,
  `<p><strong>TTLA Key Finding:</strong> Mix-adjustment confirms and slightly strengthens TS's TTLA advantage. The tNPS gap increases from +${tm.tnps.rawGap} to +${tm.tnps.adjGap}; AHT gap is +${tm.aht.adjGap} min after adjustment. SQS advantage holds (+${tm.sqs.adjGap} adjusted). TS's TTLA outperformance is genuine and not a composition artifact.</p>`
);

// Summary non-triage narrative
html = html.replace(
  /<p><strong>tNPS \(Non-Triage\):<\/strong> TS appears on par raw \(\+1\.21\), but after SKU adjustment the gap reverses to &minus;3\.97 pts\./,
  `<p><strong>tNPS (Non-Triage):</strong> TS appears on par raw (+${ta.nonTriage.rawGap}), but after SKU adjustment the gap reverses to ${ta.nonTriage.adjGap} pts.`
);

// HC summary — ~20 points below
html = html.replace(
  /Handle Conversion remains a critical issue, with TS nearly <strong>20 points below<\/strong> Non-TS\./,
  `Handle Conversion remains a critical issue, with TS <strong>${Math.abs(m.hc.rawGap).toFixed(2)} points below</strong> Non-TS raw (${m.hc.adjGap} adjusted).`
);

// Chart JS — mix compare (already partially updated; ensure labels match 5 metrics)
html = html.replace(
  /labels: \['tNPS', 'IR', 'HC \(inv CST\)'\]/,
  "labels: ['tNPS', 'IR', 'SQS', 'HC', 'CST']"
);

// M2 manager tables
replaceMixTbody('<strong>FS Performance by M2 Manager — TS vs Non-TS</strong>', r.html.m2Fs);
replaceMixTbody('<strong>TTLA Performance by M2 Manager — TS vs Non-TS</strong>', r.html.m2Ttla);

// Footer data sources
html = html.replace(
  /<p>Data sources: TS_expert_data\.csv[\s\S]*?Expert_Analysis_data_DP3\.csv \(225,931 rows\)<\/p>/,
  `<p>Data sources: Expert_Analysis_data_DP.csv (${r.sources.dp.toLocaleString('en-US')} rows) &bull; Expert_Analysis_data_DP2.csv (${r.sources.dp2.toLocaleString('en-US')} rows) &bull; Expert_Analysis_data_DP3.csv (${r.sources.dp3.toLocaleString('en-US')} rows)</p>`
);

fs.writeFileSync(HTML, html);
console.log('Patched', HTML);
