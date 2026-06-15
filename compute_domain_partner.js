const fs = require('fs');
const path = require('path');

function resolveDataFile(preferredPath, defaultName) {
    const candidates = [
        preferredPath,
        preferredPath && preferredPath.replace(/\.cvs$/i, '.csv'),
        defaultName,
        path.join(__dirname, defaultName),
        path.join(process.env.USERPROFILE || '', 'Cursor', defaultName),
        path.join(process.env.USERPROFILE || '', 'Cursor', defaultName.replace(/\.csv$/i, '.cvs')),
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`Data file not found. Tried: ${candidates.join(', ')}`);
}

function loadCsv(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
    const lines = raw.trim().split('\n');
    const headers = lines[0].split(',');
    const rows = lines.slice(1).map(l => {
        const vals = l.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = vals[i]);
        return obj;
    });
    return { filePath, headers, rows };
}

// ── Parse CSV — primary (period) + interaction (contact type / tenure) ──
const PERIOD_FILE = resolveDataFile(
    process.argv[2],
    'Expert_Analysis_data_DP.csv'
);
const INTERACTION_FILE = resolveDataFile(
    process.argv[3],
    'Expert_Analysis_data_DP2.csv'
);
const MIX_FILE = resolveDataFile(
    process.argv[4],
    'Expert_Analysis_data_DP3.csv'
);
const BOP_FILE = resolveDataFile(
    process.argv[5],
    'Expert_Analysis_data_BOP.csv'
);

const periodCsv = loadCsv(PERIOD_FILE);
const interactionCsv = loadCsv(INTERACTION_FILE);
const mixCsv = loadCsv(MIX_FILE);
const bopCsv = loadCsv(BOP_FILE);
const data = periodCsv.rows;
const interactionData = interactionCsv.rows;
const mixData = mixCsv.rows;
const bopData = bopCsv.rows;

// ── Helpers ──
const pf = v => parseFloat(v) || 0;
const fmt = (v, dec = 2) => v.toFixed(dec);
const fmtN = v => v.toLocaleString('en-US');

const PARTNERS_NON_INTUIT = ['EDUCATION AT WORK', 'FOUNDEVER', 'HIGHSPRING LLC', 'JDA', 'MAGNIT'];
const TTLA_PARTNERS = ['EDUCATION AT WORK', 'HIGHSPRING LLC', 'JDA', 'MAGNIT'];
const PARTNER_SHORT = {
    'EDUCATION AT WORK': 'EAW',
    'FOUNDEVER': 'Foundever',
    'HIGHSPRING LLC': 'Highspring',
    'JDA': 'JDA',
    'MAGNIT': 'Magnit',
    'INTUIT': 'Intuit',
    'Unknown': 'Unknown'
};

function isPartner(name) {
    return PARTNERS_NON_INTUIT.includes(name);
}

function premiumDen(r) {
    return pf(r.cst_premium_denominator) || pf(r.cst_premiun_denominator);
}

function sumField(rows, field) {
    return rows.reduce((a, r) => a + pf(r[field]), 0);
}

const SKUS = ['basic', 'deluxe', 'premium'];
const CUST_TYPES = ['New', 'Returning'];

function skuMetricFields(prefix, sku) {
    return { num: `${prefix}_${sku}_numerator`, den: `${prefix}_${sku}_denominator` };
}

function ratioRows(rows, key, mult = 1) {
    const num = key === 'hc' ? 'handled_conversion_numerator' : `${key}_numerator`;
    const den = key === 'hc' ? 'handled_conversion_denominator' : `${key}_denominator`;
    const d = sumField(rows, den);
    return d ? (sumField(rows, num) / d) * mult : null;
}

function mixFmt(n, dec = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return null;
    return Number(n.toFixed(dec));
}

function mixGap(a, b) { return mixFmt(a - b); }
function mixEffect(a, b) { return mixFmt(b - a); }

// Reweight adjusting group to base (Intuit) SKU × customer mix
function skuCustMixAdj(adjR, baseR, prefix, mult = 1) {
    let w = 0, t = 0;
    for (const s of SKUS) {
        for (const c of CUST_TYPES) {
            const adjC = adjR.filter(r => r.new_returning_customer === c);
            const baseC = baseR.filter(r => r.new_returning_customer === c);
            const { num: nf, den: df } = skuMetricFields(prefix, s);
            const adjD = sumField(adjC, df);
            const baseD = sumField(baseC, df);
            if (!adjD || !baseD) continue;
            w += (sumField(adjC, nf) / adjD) * mult * baseD;
            t += baseD;
        }
    }
    return t ? w / t : null;
}

function custMixAdj(adjR, baseR, prefix, mult = 1) {
    let w = 0, t = 0;
    for (const c of CUST_TYPES) {
        const adjC = adjR.filter(r => r.new_returning_customer === c);
        const baseC = baseR.filter(r => r.new_returning_customer === c);
        const denField = prefix === 'hc' ? 'handled_conversion_denominator' : `${prefix}_denominator`;
        const numField = prefix === 'hc' ? 'handled_conversion_numerator' : `${prefix}_numerator`;
        const adjD = sumField(adjC, denField);
        const baseD = sumField(baseC, denField);
        if (!adjD || !baseD) continue;
        w += (sumField(adjC, numField) / adjD) * mult * baseD;
        t += baseD;
    }
    return t ? w / t : null;
}

function skuMixAdj(adjR, baseR, prefix, mult = 1) {
    let w = 0, t = 0;
    for (const s of SKUS) {
        const { num: nf, den: df } = skuMetricFields(prefix, s);
        const adjD = sumField(adjR, df);
        const baseD = sumField(baseR, df);
        if (!adjD || !baseD) continue;
        w += (sumField(adjR, nf) / adjD) * mult * baseD;
        t += baseD;
    }
    return t ? w / t : null;
}

// HC from SKU-level fields only (apples-to-apples with SKU mix adjustment)
function hcFromSkuFields(rows, mult = 100) {
    let num = 0, den = 0;
    for (const s of SKUS) {
        const { num: nf, den: df } = skuMetricFields('hc', s);
        num += sumField(rows, nf);
        den += sumField(rows, df);
    }
    return den > 0 ? (num / den) * mult : null;
}

const FS_MIX_SPECS = [
    { name: 'tnps', key: 'tnps', type: 'skuCust', mult: 100, adjLabel: 'SKU × CustType', label: 'tNPS' },
    { name: 'cst', key: 'cst', type: 'skuCust', mult: 1, adjLabel: 'SKU × CustType', label: 'CST' },
    { name: 'sqs', key: 'sqs', type: 'sku', mult: 100, adjLabel: 'SKU only', label: 'SQS' },
    { name: 'ir', key: 'ir', type: 'cust', mult: 100, adjLabel: 'CustType only', label: 'IR' },
    { name: 'hc', key: 'hc', type: 'sku', mult: 100, adjLabel: 'SKU only', label: 'HC' },
];

const TTLA_MIX_SPECS = [
    { name: 'tnps', key: 'tnps', type: 'skuCust', mult: 100, adjLabel: 'SKU × CustType', label: 'tNPS' },
    { name: 'aht', key: 'aht', type: 'skuCust', mult: 1, adjLabel: 'SKU × CustType', label: 'AHT' },
    { name: 'sqs', key: 'sqs', type: 'sku', mult: 100, adjLabel: 'SKU only', label: 'SQS' },
    { name: 'ir', key: 'ir', type: 'cust', mult: 100, adjLabel: 'CustType only', label: 'IR' },
];

function buildPartnerMix(adjR, baseR, specs) {
    const out = {};
    for (const s of specs) {
        const actual = s.key === 'hc' ? hcFromSkuFields(adjR, s.mult) : ratioRows(adjR, s.key, s.mult);
        const base = s.key === 'hc' ? hcFromSkuFields(baseR, s.mult) : ratioRows(baseR, s.key, s.mult);
        let adj = actual;
        if (s.type === 'skuCust') {
            adj = skuCustMixAdj(adjR, baseR, s.key, s.mult);
        } else if (s.type === 'cust') {
            adj = custMixAdj(adjR, baseR, s.key, s.mult);
        } else if (s.type === 'sku') {
            adj = skuMixAdj(adjR, baseR, s.key, s.mult);
        }
        out[s.name] = {
            label: s.label,
            actual: mixFmt(actual),
            adj: mixFmt(adj),
            base: mixFmt(base),
            rawGap: mixGap(actual, base),
            adjGap: mixGap(adj, base),
            mixEffect: mixEffect(actual, adj),
            adjustment: s.adjLabel,
        };
    }
    return out;
}

function mixGapClass(gap, lowerBetter = false) {
    if (gap === null || Math.abs(gap) < 0.005) return 'neutral';
    const good = lowerBetter ? gap < 0 : gap > 0;
    return good ? 'better' : 'worse';
}

function fmtMixGap(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2);
}

function renderMixRow(m, lowerBetter = false) {
    const rgCls = mixGapClass(m.rawGap, lowerBetter);
    const agCls = mixGapClass(m.adjGap, lowerBetter);
    return `<tr>
        <td><strong>${m.label}</strong></td>
        <td>${m.actual ?? '—'}</td>
        <td>${m.adj ?? '—'}</td>
        <td>${m.base ?? '—'}</td>
        <td class="${rgCls}">${fmtMixGap(m.rawGap)}</td>
        <td class="${agCls}">${fmtMixGap(m.adjGap)}</td>
        <td>${fmtMixGap(m.mixEffect)}</td>
        <td>${m.adjustment.replace('×', '&times;')}</td>
    </tr>`;
}

function renderMixTable(mix, order, lowerBetter = {}) {
    const rows = order.map(k => renderMixRow(mix[k], lowerBetter[k] || false)).join('\n');
    return `<div class="card"><table>
<thead><tr>
    <th>Metric</th><th>Actual Partners</th><th>Mix-Adj Partners</th><th>Intuit (Base)</th>
    <th>Raw Gap</th><th>Adj Gap</th><th>Mix Effect</th><th>Adjustment</th>
</tr></thead>
<tbody>${rows}</tbody></table></div>`;
}

function buildMixFinding(mix, order, lowerBetter, productLabel) {
    const items = order.map(k => {
        const m = mix[k];
        if (!m || m.rawGap === null) return '';
        const lb = lowerBetter[k];
        const rawBetter = lb ? m.rawGap < 0 : m.rawGap > 0;
        const adjBetter = lb ? m.adjGap < 0 : m.adjGap > 0;
        const persisted = rawBetter === adjBetter;
        return `<li><strong>${m.label}:</strong> Raw gap ${fmtMixGap(m.rawGap)} → adjusted ${fmtMixGap(m.adjGap)} (mix effect ${fmtMixGap(m.mixEffect)}). ${persisted ? 'Advantage/disadvantage <strong>persists</strong> after mix adjustment.' : 'Mix adjustment <strong>changes interpretation</strong> of the gap.'}</li>`;
    }).filter(Boolean).join('\n');
    return `<div class="callout"><strong>${productLabel} Mix-Adjusted Key Findings:</strong><ul style="margin-top:0.5rem;padding-left:1.25rem;">${items}</ul></div>`;
}

// ── Aggregation engine ──
function aggregate(rows) {
    let tnps_num = 0, tnps_den = 0;
    let ir_num = 0, ir_den = 0;
    let sqs_num = 0, sqs_den = 0;
    let hc_num = 0, hc_den = 0;
    let aht_num = 0, aht_den = 0;
    let cst_num = 0, cst_den = 0;
    let sku_basic_den = 0, sku_deluxe_den = 0, sku_premium_den = 0;
    let cst_basic_num = 0, cst_deluxe_num = 0, cst_premium_num = 0;

    rows.forEach(r => {
        tnps_num += pf(r.tnps_numerator);
        tnps_den += pf(r.tnps_denominator);
        ir_num += pf(r.ir_numerator);
        ir_den += pf(r.ir_denominator);
        sqs_num += pf(r.sqs_numerator);
        sqs_den += pf(r.sqs_denominator);
        hc_num += pf(r.handled_conversion_numerator);
        hc_den += pf(r.handled_conversion_denominator);
        aht_num += pf(r.aht_numerator);
        aht_den += pf(r.aht_denominator);
        cst_num += pf(r.cst_numerator);
        cst_den += pf(r.cst_denominator);
        sku_basic_den += pf(r.cst_basic_denominator);
        sku_deluxe_den += pf(r.cst_deluxe_denominator);
        sku_premium_den += premiumDen(r);
        cst_basic_num += pf(r.cst_basic_numerator);
        cst_deluxe_num += pf(r.cst_deluxe_numerator);
        cst_premium_num += pf(r.cst_premium_numerator);
    });

    const sku_total = sku_basic_den + sku_deluxe_den + sku_premium_den;

    return {
        tnps: tnps_den > 0 ? (tnps_num / tnps_den) * 100 : null,
        ir: ir_den > 0 ? (ir_num / ir_den) * 100 : null,
        sqs: sqs_den > 0 ? (sqs_num / sqs_den) * 100 : null,
        hc: hc_den > 0 ? (hc_num / hc_den) * 100 : null,
        aht: aht_den > 0 ? aht_num / aht_den : null,
        cst: cst_den > 0 ? cst_num / cst_den : null,
        cst_basic: sku_basic_den > 0 ? cst_basic_num / sku_basic_den : null,
        cst_deluxe: sku_deluxe_den > 0 ? cst_deluxe_num / sku_deluxe_den : null,
        cst_premium: sku_premium_den > 0 ? cst_premium_num / sku_premium_den : null,
        sku_basic_pct: sku_total > 0 ? (sku_basic_den / sku_total) * 100 : null,
        sku_deluxe_pct: sku_total > 0 ? (sku_deluxe_den / sku_total) * 100 : null,
        sku_premium_pct: sku_total > 0 ? (sku_premium_den / sku_total) * 100 : null,
        sku_total,
        tnps_den, ir_den, sqs_den, hc_den, aht_den, cst_den,
    };
}

function metricVal(m, key) {
    if (m[key] === null) return 'N/A';
    return fmt(m[key], 2);
}

function aggregateBop(rows) {
    let bop_num = 0, bop_den = 0;
    rows.forEach(r => {
        bop_num += pf(r.bop_num);
        bop_den += pf(r.bop_denom);
    });
    return {
        bop: bop_den > 0 ? (bop_num / bop_den) * 100 : null,
        bop_den,
    };
}

function bopVal(agg) {
    return agg.bop === null || agg.bop === undefined ? 'N/A' : `${fmt(agg.bop, 2)}%`;
}

function computeBopOverallRows(rows, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const result = [];
    Object.entries(partnerGroups).forEach(([name, pRows]) => {
        result.push({ name: PARTNER_SHORT[name] || name, agg: aggregateBop(pRows), type: 'partner' });
    });
    if (allPartnerRows.length > 0) {
        result.push({ name: 'Partners Total', agg: aggregateBop(allPartnerRows), type: 'partners_total' });
    }
    if (intuitRows.length > 0) {
        result.push({ name: 'Intuit', agg: aggregateBop(intuitRows), type: 'intuit' });
    }
    return result;
}

function buildBopBreakdown(rows, dimField, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const dimValues = [...new Set(rows.map(r => r[dimField]))].filter(v => v && v !== 'N/A' && v !== 'null' && v !== 'Unknown').sort();

    const result = {};
    dimValues.forEach(dv => {
        result[dv] = [];
        Object.entries(partnerGroups).forEach(([name, pRows]) => {
            const filtered = pRows.filter(r => r[dimField] === dv);
            if (filtered.length > 0) {
                result[dv].push({ name: PARTNER_SHORT[name], agg: aggregateBop(filtered), type: 'partner' });
            }
        });
        const apFiltered = allPartnerRows.filter(r => r[dimField] === dv);
        if (apFiltered.length > 0) {
            result[dv].push({ name: 'Partners Total', agg: aggregateBop(apFiltered), type: 'partners_total' });
        }
        const iFiltered = intuitRows.filter(r => r[dimField] === dv);
        if (iFiltered.length > 0) {
            result[dv].push({ name: 'Intuit', agg: aggregateBop(iFiltered), type: 'intuit' });
        }
    });
    return { dimValues, data: result };
}

function buildBopPLBreakdown(rows, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const knownPLs = ['PL1', 'PL2', 'PL3', 'PL4'];
    const dimValues = [...knownPLs, 'Other'];
    const result = {};
    dimValues.forEach(dv => {
        result[dv] = [];
        const filterFn = dv === 'Other'
            ? r => !knownPLs.includes(r.proficiency_level)
            : r => r.proficiency_level === dv;

        Object.entries(partnerGroups).forEach(([name, pRows]) => {
            const filtered = pRows.filter(filterFn);
            if (filtered.length > 0) {
                result[dv].push({ name: PARTNER_SHORT[name], agg: aggregateBop(filtered), type: 'partner' });
            }
        });
        const apFiltered = allPartnerRows.filter(filterFn);
        if (apFiltered.length > 0) {
            result[dv].push({ name: 'Partners Total', agg: aggregateBop(apFiltered), type: 'partners_total' });
        }
        const iFiltered = intuitRows.filter(filterFn);
        if (iFiltered.length > 0) {
            result[dv].push({ name: 'Intuit', agg: aggregateBop(iFiltered), type: 'intuit' });
        }
    });
    return { dimValues, data: result };
}

function renderBopOverallTable(id, title, tableData) {
    let html = `<h3 id="${id}">${title}</h3>\n<div class="card">\n<table>\n<thead><tr><th>Group</th><th>BOP CST %</th></tr></thead>\n<tbody>\n`;
    tableData.forEach(row => {
        html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
        html += `<td>${bopVal(row.agg)}</td></tr>\n`;
    });
    html += `</tbody></table>\n</div>\n`;
    return html;
}

function renderBopBreakdownSection(id, title, breakdownObj, dimLabel) {
    const { dimValues, data: bData } = breakdownObj;
    let html = title ? `<h3 id="${id}">${title}</h3>\n` : '';
    dimValues.forEach(dv => {
        const rows = bData[dv];
        if (!rows || rows.length === 0) return;
        html += `<div class="card">\n<div class="card-header"><strong>${dimLabel}: ${dv}</strong></div>\n`;
        html += `<table>\n<thead><tr><th>Group</th><th>BOP CST %</th></tr></thead>\n<tbody>\n`;
        rows.forEach(row => {
            html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
            html += `<td>${bopVal(row.agg)}</td></tr>\n`;
        });
        html += `</tbody></table>\n</div>\n`;
    });
    return html;
}

function productVolume(r) {
    return r.product_name === 'TTL Full Service Consumer' ? pf(r.cst_denominator) : pf(r.aht_denominator);
}

function combinedVolume(rows) {
    return rows.reduce((s, r) => s + productVolume(r), 0);
}

// ── Split data (primary = period dataset) ──
const ttla = data.filter(r => r.product_name === 'TTL Assisted Consumer');
const fsData = data.filter(r => r.product_name === 'TTL Full Service Consumer');

// Interaction dataset — contact type & tenure (no reporting period)
const ttlaIx = interactionData.filter(r => r.product_name === 'TTL Assisted Consumer');
const fsIx = interactionData.filter(r => r.product_name === 'TTL Full Service Consumer');

// ── Build analysis groups ──
function buildGroups(rows, partnerList) {
    const pList = partnerList || PARTNERS_NON_INTUIT;
    const intuitRows = rows.filter(r => r.expert_partner_name === 'INTUIT');
    const partnerGroups = {};
    pList.forEach(p => {
        const pr = rows.filter(r => r.expert_partner_name === p);
        if (pr.length > 0) partnerGroups[p] = pr;
    });
    const allPartnerRows = rows.filter(r => pList.includes(r.expert_partner_name));
    return { intuitRows, partnerGroups, allPartnerRows };
}

function buildOverallTable(rows, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const result = [];
    Object.entries(partnerGroups).forEach(([name, pRows]) => {
        result.push({ name: PARTNER_SHORT[name] || name, agg: aggregate(pRows), type: 'partner' });
    });
    if (allPartnerRows.length > 0) {
        result.push({ name: 'Partners Total', agg: aggregate(allPartnerRows), type: 'partners_total' });
    }
    if (intuitRows.length > 0) {
        result.push({ name: 'Intuit', agg: aggregate(intuitRows), type: 'intuit' });
    }
    return result;
}

function buildBreakdown(rows, dimField, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const dimValues = [...new Set(rows.map(r => r[dimField]))].filter(v => v && v !== 'N/A' && v !== 'null' && v !== 'Unknown').sort();

    const result = {};
    dimValues.forEach(dv => {
        result[dv] = [];
        Object.entries(partnerGroups).forEach(([name, pRows]) => {
            const filtered = pRows.filter(r => r[dimField] === dv);
            if (filtered.length > 0) {
                result[dv].push({ name: PARTNER_SHORT[name], agg: aggregate(filtered), type: 'partner' });
            }
        });
        const apFiltered = allPartnerRows.filter(r => r[dimField] === dv);
        if (apFiltered.length > 0) {
            result[dv].push({ name: 'Partners Total', agg: aggregate(apFiltered), type: 'partners_total' });
        }
        const iFiltered = intuitRows.filter(r => r[dimField] === dv);
        if (iFiltered.length > 0) {
            result[dv].push({ name: 'Intuit', agg: aggregate(iFiltered), type: 'intuit' });
        }
    });

    return { dimValues, data: result };
}

// PL breakdown: PL1-PL4 first, everything else blended as "Other"
function buildPLBreakdown(rows, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const knownPLs = ['PL1', 'PL2', 'PL3', 'PL4'];
    const dimValues = [...knownPLs, 'Other'];

    const result = {};
    dimValues.forEach(dv => {
        result[dv] = [];
        const filterFn = dv === 'Other'
            ? r => !knownPLs.includes(r.proficiency_level)
            : r => r.proficiency_level === dv;

        Object.entries(partnerGroups).forEach(([name, pRows]) => {
            const filtered = pRows.filter(filterFn);
            if (filtered.length > 0) {
                result[dv].push({ name: PARTNER_SHORT[name], agg: aggregate(filtered), type: 'partner' });
            }
        });
        const apFiltered = allPartnerRows.filter(filterFn);
        if (apFiltered.length > 0) {
            result[dv].push({ name: 'Partners Total', agg: aggregate(apFiltered), type: 'partners_total' });
        }
        const iFiltered = intuitRows.filter(filterFn);
        if (iFiltered.length > 0) {
            result[dv].push({ name: 'Intuit', agg: aggregate(iFiltered), type: 'intuit' });
        }
    });

    return { dimValues, data: result };
}

// Inline breakdown: rows = groups, columns = dim values x metrics (for contact type & hire type)
function buildInlineBreakdown(rows, dimField, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const dimValues = [...new Set(rows.map(r => r[dimField]))].filter(v => v && v !== 'N/A' && v !== 'Unknown').sort();

    const groups = [];
    Object.entries(partnerGroups).forEach(([name, pRows]) => {
        const aggs = {};
        dimValues.forEach(dv => {
            const filtered = pRows.filter(r => r[dimField] === dv);
            aggs[dv] = filtered.length > 0 ? aggregate(filtered) : null;
        });
        groups.push({ name: PARTNER_SHORT[name], aggs, type: 'partner' });
    });

    const ptAggs = {};
    dimValues.forEach(dv => {
        const filtered = allPartnerRows.filter(r => r[dimField] === dv);
        ptAggs[dv] = filtered.length > 0 ? aggregate(filtered) : null;
    });
    if (allPartnerRows.length > 0) groups.push({ name: 'Partners Total', aggs: ptAggs, type: 'partners_total' });

    const iAggs = {};
    dimValues.forEach(dv => {
        const filtered = intuitRows.filter(r => r[dimField] === dv);
        iAggs[dv] = filtered.length > 0 ? aggregate(filtered) : null;
    });
    if (intuitRows.length > 0) groups.push({ name: 'Intuit', aggs: iAggs, type: 'intuit' });

    return { dimValues, groups };
}

// Tenure pivot: for each metric, rows = groups, columns = tenure categories
function buildTenurePivot(rows, partnerList) {
    const TENURE_ORDER = ['< 30 days', '30-60 days', '60-90 days', '90-120 days', '120+ days'];
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const allTenures = [...new Set(rows.map(r => r.expert_tenure_category))].filter(v => v && v !== 'N/A');
    const tenures = TENURE_ORDER.filter(t => allTenures.includes(t));

    const groups = [];
    Object.entries(partnerGroups).forEach(([name, pRows]) => {
        const aggs = {};
        tenures.forEach(t => {
            const filtered = pRows.filter(r => r.expert_tenure_category === t);
            aggs[t] = filtered.length > 0 ? aggregate(filtered) : null;
        });
        groups.push({ name: PARTNER_SHORT[name], aggs, type: 'partner' });
    });

    const ptAggs = {};
    tenures.forEach(t => {
        const filtered = allPartnerRows.filter(r => r.expert_tenure_category === t);
        ptAggs[t] = filtered.length > 0 ? aggregate(filtered) : null;
    });
    if (allPartnerRows.length > 0) groups.push({ name: 'Partners Total', aggs: ptAggs, type: 'partners_total' });

    const iAggs = {};
    tenures.forEach(t => {
        const filtered = intuitRows.filter(r => r.expert_tenure_category === t);
        iAggs[t] = filtered.length > 0 ? aggregate(filtered) : null;
    });
    if (intuitRows.length > 0) groups.push({ name: 'Intuit', aggs: iAggs, type: 'intuit' });

    return { tenures, groups };
}

// Reporting period pivot: same shape as tenure pivot but on reporting_period
const PERIOD_ORDER = [
    '1. Before Season', '2. January-26', '3. February-26_1', '4. February-26_2',
    '5. March-26_1', '6. March-26_2', '7. April-26', '8. After Season'
];
const ATTR_ORDER = ['Active', 'AttrDuringTraining', 'AttrBeforePeak', 'AttrAfterPeak'];

function buildPeriodPivot(rows, partnerList) {
    const { intuitRows, partnerGroups, allPartnerRows } = buildGroups(rows, partnerList);
    const allPeriods = [...new Set(rows.map(r => r.reporting_period))].filter(v => v);
    const periods = PERIOD_ORDER.filter(p => allPeriods.includes(p));

    const groups = [];
    Object.entries(partnerGroups).forEach(([name, pRows]) => {
        const aggs = {};
        periods.forEach(p => {
            const filtered = pRows.filter(r => r.reporting_period === p);
            aggs[p] = filtered.length > 0 ? aggregate(filtered) : null;
        });
        groups.push({ name: PARTNER_SHORT[name], aggs, type: 'partner' });
    });

    const ptAggs = {};
    periods.forEach(p => {
        const filtered = allPartnerRows.filter(r => r.reporting_period === p);
        ptAggs[p] = filtered.length > 0 ? aggregate(filtered) : null;
    });
    if (allPartnerRows.length > 0) groups.push({ name: 'Partners Total', aggs: ptAggs, type: 'partners_total' });

    const iAggs = {};
    periods.forEach(p => {
        const filtered = intuitRows.filter(r => r.reporting_period === p);
        iAggs[p] = filtered.length > 0 ? aggregate(filtered) : null;
    });
    if (intuitRows.length > 0) groups.push({ name: 'Intuit', aggs: iAggs, type: 'intuit' });

    return { tenures: periods, groups };
}

// ── Metric config ──
const TTLA_METRICS = ['tnps', 'ir', 'sqs', 'aht'];
const FS_METRICS = ['tnps', 'ir', 'sqs', 'hc', 'cst'];
const FS_TENURE_METRICS = ['tnps', 'ir', 'sqs', 'hc'];

const METRIC_LABELS = { tnps: 'tNPS', ir: 'IR', sqs: 'SQS', hc: 'HC', aht: 'AHT', cst: 'CST' };
const METRIC_DIRECTION = { tnps: 'higher', ir: 'higher', sqs: 'higher', hc: 'higher', aht: 'lower', cst: 'lower' };

// ── Compute all aggregations ──
const ttlaOverall = buildOverallTable(ttla, TTLA_PARTNERS);
const fsOverall = buildOverallTable(fsData);

const ttlaByRole = buildBreakdown(ttla, 'expert_role', TTLA_PARTNERS);
const fsByRole = buildBreakdown(fsData, 'expert_role');

const ttlaByPL = buildPLBreakdown(ttla, TTLA_PARTNERS);
const fsByPL = buildPLBreakdown(fsData);

const ttlaByHire = buildInlineBreakdown(ttla, 'hire_type', TTLA_PARTNERS);
const fsByHire = buildInlineBreakdown(fsData, 'hire_type');

const fsByAttr = buildBreakdown(fsData, 'attr_status_adj');
const ttlaByAttr = buildBreakdown(ttla, 'attr_status_adj', TTLA_PARTNERS);

const hasInteraction = interactionData.length > 0;
const hasTenure = hasInteraction && interactionData.some(r => r.expert_tenure_category && r.expert_tenure_category !== 'N/A');
const hasContactType = hasInteraction && ttlaIx.some(r => r.contact_type && r.contact_type !== 'N/A' && r.contact_type !== 'Unknown');

const ttlaTenure = hasTenure ? buildTenurePivot(ttlaIx, TTLA_PARTNERS) : null;
const fsTenure = hasTenure ? buildTenurePivot(fsIx) : null;

const ttlaByCT = hasContactType ? buildInlineBreakdown(ttlaIx, 'contact_type', TTLA_PARTNERS) : null;

// Mix-adjusted metrics (DP3 — Intuit base, Partners Total adjusting)
const fsMixRows = mixData.filter(r => r.product_name === 'TTL Full Service Consumer');
const ttlaMixRows = mixData.filter(r => r.product_name === 'TTL Assisted Consumer');
const fsMixIntuit = fsMixRows.filter(r => r.expert_partner_name === 'INTUIT');
const fsMixPartners = fsMixRows.filter(r => PARTNERS_NON_INTUIT.includes(r.expert_partner_name));
const ttlaMixIntuit = ttlaMixRows.filter(r => r.expert_partner_name === 'INTUIT');
const ttlaMixPartners = ttlaMixRows.filter(r => TTLA_PARTNERS.includes(r.expert_partner_name));

const fsMix = buildPartnerMix(fsMixPartners, fsMixIntuit, FS_MIX_SPECS);
const ttlaMix = buildPartnerMix(ttlaMixPartners, ttlaMixIntuit, TTLA_MIX_SPECS);
const FS_MIX_ORDER = ['tnps', 'cst', 'sqs', 'ir', 'hc'];
const TTLA_MIX_ORDER = ['tnps', 'aht', 'sqs', 'ir'];
const FS_MIX_LOWER = { cst: true, aht: true };

const bopOverall = computeBopOverallRows(bopData);
const bopByHire = buildBopBreakdown(bopData, 'hire_type');
const bopByRole = buildBopBreakdown(bopData, 'expert_role');
const bopByPL = buildBopPLBreakdown(bopData);
const TTLA_MIX_LOWER = { aht: true };

const fsByPeriod = buildPeriodPivot(fsData);
const ttlaByPeriod = buildPeriodPivot(ttla, TTLA_PARTNERS);

function partnerBetter(pVal, iVal, key) {
    if (pVal === null || iVal === null) return null;
    const diff = pVal - iVal;
    const dir = METRIC_DIRECTION[key];
    return (dir === 'higher' && diff > 0) || (dir === 'lower' && diff < 0);
}

function comparePartnerIntuit(pAgg, iAgg, metrics) {
    const advantages = [], disadvantages = [];
    metrics.forEach(m => {
        if (pAgg[m] === null || iAgg[m] === null) return;
        const diff = pAgg[m] - iAgg[m];
        const entry = { key: m, label: METRIC_LABELS[m], pVal: pAgg[m], iVal: iAgg[m], diff };
        if (partnerBetter(pAgg[m], iAgg[m], m)) advantages.push(entry);
        else if (diff !== 0) disadvantages.push(entry);
    });
    return { advantages, disadvantages };
}

function metricLine(entry, prefix = '') {
    return `<strong>${prefix}${entry.label}:</strong> Partners ${fmt(entry.pVal, 2)} vs Intuit ${fmt(entry.iVal, 2)} (${diffStr(entry.diff)})`;
}

function breakdownSliceCompare(breakdown, dimValue, metrics) {
    const rows = breakdown?.data?.[dimValue];
    if (!rows) return null;
    const p = rows.find(r => r.type === 'partners_total');
    const i = rows.find(r => r.type === 'intuit');
    if (!p || !i) return null;
    return comparePartnerIntuit(p.agg, i.agg, metrics);
}

function inlineSliceCompare(inlineBreakdown, dimValue, metrics) {
    const p = inlineBreakdown.groups.find(r => r.type === 'partners_total');
    const i = inlineBreakdown.groups.find(r => r.type === 'intuit');
    if (!p || !i || !p.aggs[dimValue] || !i.aggs[dimValue]) return null;
    return comparePartnerIntuit(p.aggs[dimValue], i.aggs[dimValue], metrics);
}

function renderAdvDisLists(advantages, disadvantages, emptyMsg = '') {
    let html = '';
    if (advantages.length) {
        html += `<ul style="margin-top:0.5rem;padding-left:1.25rem;">${advantages.map(a => `<li><span class="better">▲</span> ${metricLine(a)}</li>`).join('\n')}</ul>`;
    }
    if (disadvantages.length) {
        html += `<ul style="margin-top:0.5rem;padding-left:1.25rem;">${disadvantages.map(d => `<li><span class="worse">▼</span> ${metricLine(d)}</li>`).join('\n')}</ul>`;
    }
    if (!advantages.length && !disadvantages.length && emptyMsg) html += `<p style="margin-top:0.5rem;">${emptyMsg}</p>`;
    return html;
}

function buildDrillDownInsights() {
    const fsP = fsOverall.find(r => r.type === 'partners_total');
    const fsI = fsOverall.find(r => r.type === 'intuit');
    const ttlaP = ttlaOverall.find(r => r.type === 'partners_total');
    const ttlaI = ttlaOverall.find(r => r.type === 'intuit');

    const partnerRows = data.filter(r => PARTNERS_NON_INTUIT.includes(r.expert_partner_name));
    const intuitRows = data.filter(r => r.expert_partner_name === 'INTUIT');
    const pVol = combinedVolume(partnerRows);
    const iVol = combinedVolume(intuitRows);
    const pNHVol = combinedVolume(partnerRows.filter(r => r.hire_type === 'New Hire'));
    const pRHVol = combinedVolume(partnerRows.filter(r => r.hire_type === 'Re-Hire'));
    const iNHVol = combinedVolume(intuitRows.filter(r => r.hire_type === 'New Hire'));
    const iRHVol = combinedVolume(intuitRows.filter(r => r.hire_type === 'Re-Hire'));

    const fsCmp = fsP && fsI ? comparePartnerIntuit(fsP.agg, fsI.agg, FS_METRICS) : { advantages: [], disadvantages: [] };
    const ttlaCmp = ttlaP && ttlaI ? comparePartnerIntuit(ttlaP.agg, ttlaI.agg, TTLA_METRICS) : { advantages: [], disadvantages: [] };

    const allAdv = [
        ...fsCmp.advantages.map(a => ({ ...a, label: `FS ${a.label}` })),
        ...ttlaCmp.advantages.map(a => ({ ...a, label: `TTLA ${a.label}` })),
    ];
    const allDis = [
        ...fsCmp.disadvantages.map(d => ({ ...d, label: `FS ${d.label}` })),
        ...ttlaCmp.disadvantages.map(d => ({ ...d, label: `TTLA ${d.label}` })),
    ];

    let html = `<h3>Drill-Down Insights</h3>`;

    html += `<div class="callout success">
    <strong>Partner Advantages — Overall</strong>
    ${renderAdvDisLists(allAdv, [], allAdv.length ? '' : 'No overall metrics where Partners Total outperforms Intuit.')}
</div>`;

    html += `<div class="callout danger">
    <strong>Partner Disadvantages — Overall</strong>
    ${renderAdvDisLists([], allDis, allDis.length ? '' : 'No overall metrics where Intuit outperforms Partners Total.')}
</div>`;

    html += `<div class="callout">
    <strong>Workforce composition — New Hire vs Re-Hire:</strong>
    <ul style="margin-top:0.5rem;padding-left:1.25rem;">
    <li><strong>Partners</strong> are predominantly New Hire: <strong>${fmt(pNHVol / pVol * 100, 1)}%</strong> of volume vs <strong>${fmt(pRHVol / pVol * 100, 1)}%</strong> Re-Hire.</li>
    <li><strong>Intuit</strong> is the inverse: <strong>${fmt(iNHVol / iVol * 100, 1)}%</strong> New Hire vs <strong>${fmt(iRHVol / iVol * 100, 1)}%</strong> Re-Hire.</li>
    <li>Aggregate comparisons skew toward a more tenured Intuit workforce — segment by hire type before drawing conclusions.</li>
    </ul>
</div>`;

    ['New Hire', 'Re-Hire'].forEach(hireType => {
        const fsSlice = inlineSliceCompare(fsByHire, hireType, FS_METRICS);
        const ttlaSlice = inlineSliceCompare(ttlaByHire, hireType, TTLA_METRICS);
        const adv = [
            ...(fsSlice?.advantages.map(a => ({ ...a, label: `FS ${a.label}` })) || []),
            ...(ttlaSlice?.advantages.map(a => ({ ...a, label: `TTLA ${a.label}` })) || []),
        ];
        const dis = [
            ...(fsSlice?.disadvantages.map(d => ({ ...d, label: `FS ${d.label}` })) || []),
            ...(ttlaSlice?.disadvantages.map(d => ({ ...d, label: `TTLA ${d.label}` })) || []),
        ];
        let footnote = '';
        if (hireType === 'New Hire') {
            footnote = `<p style="margin-top:0.5rem;font-size:0.9rem;color:var(--muted);">Partners carry ${fmt(pNHVol / pVol * 100, 1)}% of volume as New Hires — the segment where Partners most often lead on tNPS.</p>`;
        } else {
            const rhTnpsAdv = [...(fsSlice?.advantages || []), ...(ttlaSlice?.advantages || [])].some(a => a.key === 'tnps');
            footnote = `<p style="margin-top:0.5rem;font-size:0.9rem;color:var(--muted);">Re-Hire is Intuit's dominant cohort (${fmt(iRHVol / iVol * 100, 1)}% of volume). tNPS gap narrows to near parity${rhTnpsAdv ? ', with Partners leading tNPS in at least one product' : ''}; Intuit typically retains IR advantages on TTLA.</p>`;
        }
        html += `<div class="callout">
    <strong>${hireType} — Partner vs Intuit:</strong>
    ${adv.length ? `<p style="margin-top:0.5rem;margin-bottom:0.25rem;"><span class="better">Advantages</span></p>${renderAdvDisLists(adv, [])}` : ''}
    ${dis.length ? `<p style="margin-top:0.75rem;margin-bottom:0.25rem;"><span class="worse">Disadvantages</span></p>${renderAdvDisLists([], dis)}` : ''}
    ${!adv.length && !dis.length ? '<p style="margin-top:0.5rem;">Insufficient data for this segment.</p>' : ''}
    ${footnote}
</div>`;
    });

    if (hasContactType) {
        const ttlaPartners = ttlaIx.filter(r => TTLA_PARTNERS.includes(r.expert_partner_name));
        const ttlaIntuit = ttlaIx.filter(r => r.expert_partner_name === 'INTUIT');
        function contactMetric(rows, metric) {
            if (metric === 'tnps') {
                let n = 0, d = 0;
                rows.forEach(r => { n += pf(r.tnps_numerator); d += pf(r.tnps_denominator); });
                return d ? (n / d) * 100 : null;
            }
            let n = 0, d = 0;
            rows.forEach(r => { n += pf(r.aht_numerator); d += pf(r.aht_denominator); });
            return d ? n / d : null;
        }
        function contactVolShare(rows, ct) {
            const total = rows.reduce((s, r) => s + pf(r.aht_denominator), 0);
            const ctVol = rows.filter(r => r.contact_type === ct).reduce((s, r) => s + pf(r.aht_denominator), 0);
            return total > 0 ? (ctVol / total) * 100 : 0;
        }
        ['Phone', 'Chat'].forEach(ct => {
            const pRows = ttlaPartners.filter(r => r.contact_type === ct);
            const iRows = ttlaIntuit.filter(r => r.contact_type === ct);
            const pTnps = contactMetric(pRows, 'tnps');
            const iTnps = contactMetric(iRows, 'tnps');
            const pAht = contactMetric(pRows, 'aht');
            const iAht = contactMetric(iRows, 'aht');
            const tnpsAdv = pTnps !== null && iTnps !== null && pTnps > iTnps;
            const ahtAdv = pAht !== null && iAht !== null && pAht < iAht;
            html += `<div class="callout">
    <strong>TTLA ${ct} — Partner vs Intuit:</strong>
    <ul style="margin-top:0.5rem;padding-left:1.25rem;">
    <li><strong>Volume mix:</strong> Partners ${fmt(contactVolShare(ttlaPartners, ct), 1)}% ${ct} vs Intuit ${fmt(contactVolShare(ttlaIntuit, ct), 1)}% ${ct}.</li>
    <li><strong>tNPS:</strong> Partners ${fmt(pTnps, 2)} vs Intuit ${fmt(iTnps, 2)} (${diffStr(pTnps - iTnps)}) — <span class="${tnpsAdv ? 'better' : 'worse'}">${tnpsAdv ? 'Partner advantage' : 'Partner disadvantage'}</span></li>
    <li><strong>AHT:</strong> Partners ${fmt(pAht, 2)} vs Intuit ${fmt(iAht, 2)} min (${diffStr(pAht - iAht)}) — <span class="${ahtAdv ? 'better' : 'worse'}">${ahtAdv ? 'Partner advantage (faster)' : 'Partner disadvantage (slower)'}</span></li>
    </ul>
</div>`;
        });
    }

    const roleInsights = [];
    (fsByRole.dimValues || []).forEach(role => {
        const fsSlice = breakdownSliceCompare(fsByRole, role, ['tnps', 'hc', 'cst']);
        const ttlaSlice = breakdownSliceCompare(ttlaByRole, role, ['tnps', 'aht']);
        if (!fsSlice && !ttlaSlice) return;
        const advLabels = [
            ...(fsSlice?.advantages.map(a => `FS ${a.label}`) || []),
            ...(ttlaSlice?.advantages.map(a => `TTLA ${a.label}`) || []),
        ];
        const disLabels = [
            ...(fsSlice?.disadvantages.map(d => `FS ${d.label}`) || []),
            ...(ttlaSlice?.disadvantages.map(d => `TTLA ${d.label}`) || []),
        ];
        if (advLabels.length || disLabels.length) {
            roleInsights.push(`<li><strong>${role}:</strong> ${advLabels.length ? `<span class="better">Adv: ${advLabels.join(', ')}</span>` : ''}${advLabels.length && disLabels.length ? ' · ' : ''}${disLabels.length ? `<span class="worse">Dis: ${disLabels.join(', ')}</span>` : ''}</li>`);
        }
    });
    if (roleInsights.length) {
        html += `<div class="callout"><strong>By Expert Role — Partner vs Intuit:</strong><ul style="margin-top:0.5rem;padding-left:1.25rem;">${roleInsights.join('\n')}</ul></div>`;
    }

    const plInsights = [];
    (fsByPL.dimValues || []).forEach(pl => {
        const fsSlice = breakdownSliceCompare(fsByPL, pl, ['tnps', 'hc']);
        const ttlaSlice = breakdownSliceCompare(ttlaByPL, pl, ['tnps', 'aht']);
        const adv = [
            ...(fsSlice?.advantages.map(a => ({ ...a, label: `FS ${a.label}` })) || []),
            ...(ttlaSlice?.advantages.map(a => ({ ...a, label: `TTLA ${a.label}` })) || []),
        ];
        const dis = [
            ...(fsSlice?.disadvantages.map(d => ({ ...d, label: `FS ${d.label}` })) || []),
            ...(ttlaSlice?.disadvantages.map(d => ({ ...d, label: `TTLA ${d.label}` })) || []),
        ];
        if (adv.length || dis.length) {
            plInsights.push(`<li><strong>${pl}:</strong> ${adv.length ? `<span class="better">${adv.map(a => a.label).join(', ')}</span>` : '—'} vs ${dis.length ? `<span class="worse">${dis.map(d => d.label).join(', ')}</span>` : '—'}</li>`);
        }
    });
    if (plInsights.length) {
        html += `<div class="callout"><strong>By Proficiency Level — wins vs gaps:</strong><ul style="margin-top:0.5rem;padding-left:1.25rem;">${plInsights.join('\n')}</ul></div>`;
    }

    if (fsP && fsI && fsP.agg.cst_basic !== null) {
        const skuMetrics = ['cst_basic', 'cst_deluxe', 'cst_premium'];
        const skuLabels = { cst_basic: 'Basic CST', cst_deluxe: 'Deluxe CST', cst_premium: 'Premium CST' };
        const skuAdv = [], skuDis = [];
        skuMetrics.forEach(k => {
            if (fsP.agg[k] === null || fsI.agg[k] === null) return;
            const diff = fsP.agg[k] - fsI.agg[k];
            const entry = { label: skuLabels[k], pVal: fsP.agg[k], iVal: fsI.agg[k], diff };
            if (partnerBetter(fsP.agg[k], fsI.agg[k], 'cst')) skuAdv.push(entry);
            else if (diff !== 0) skuDis.push(entry);
        });
        html += `<div class="callout"><strong>FS SKU Tier — CST (lower is better):</strong>
    ${skuAdv.length ? `<p style="margin-top:0.5rem;"><span class="better">Partner advantage</span></p>${renderAdvDisLists(skuAdv, [])}` : ''}
    ${skuDis.length ? `<p style="margin-top:0.5rem;"><span class="worse">Partner disadvantage</span></p>${renderAdvDisLists([], skuDis)}` : ''}
    <p style="margin-top:0.5rem;font-size:0.9rem;color:var(--muted);">Partners handle ${fmt(fsP.agg.sku_basic_pct, 1)}% Basic vs Intuit ${fmt(fsI.agg.sku_basic_pct, 1)}% — mix context matters when reading aggregate CST.</p>
</div>`;
    }

    const partnerHighlights = [];
    fsOverall.filter(r => r.type === 'partner').forEach(p => {
        if (!fsI) return;
        const beats = FS_METRICS.filter(m => p.agg[m] !== null && fsI.agg[m] !== null && partnerBetter(p.agg[m], fsI.agg[m], m));
        const lags = FS_METRICS.filter(m => p.agg[m] !== null && fsI.agg[m] !== null && !partnerBetter(p.agg[m], fsI.agg[m], m) && p.agg[m] !== fsI.agg[m]);
        if (beats.length || lags.length) {
            partnerHighlights.push(`<li><strong>${p.name} (FS):</strong> ${beats.length ? `<span class="better">beats Intuit on ${beats.map(m => METRIC_LABELS[m]).join(', ')}</span>` : ''}${beats.length && lags.length ? ' · ' : ''}${lags.length ? `<span class="worse">lags on ${lags.map(m => METRIC_LABELS[m]).join(', ')}</span>` : ''}</li>`);
        }
    });
    ttlaOverall.filter(r => r.type === 'partner').forEach(p => {
        if (!ttlaI) return;
        const beats = TTLA_METRICS.filter(m => p.agg[m] !== null && ttlaI.agg[m] !== null && partnerBetter(p.agg[m], ttlaI.agg[m], m));
        const lags = TTLA_METRICS.filter(m => p.agg[m] !== null && ttlaI.agg[m] !== null && !partnerBetter(p.agg[m], ttlaI.agg[m], m) && p.agg[m] !== ttlaI.agg[m]);
        if (beats.length || lags.length) {
            partnerHighlights.push(`<li><strong>${p.name} (TTLA):</strong> ${beats.length ? `<span class="better">beats Intuit on ${beats.map(m => METRIC_LABELS[m]).join(', ')}</span>` : ''}${beats.length && lags.length ? ' · ' : ''}${lags.length ? `<span class="worse">lags on ${lags.map(m => METRIC_LABELS[m]).join(', ')}</span>` : ''}</li>`);
        }
    });
    if (partnerHighlights.length) {
        html += `<div class="callout"><strong>Individual Partner Standouts:</strong><ul style="margin-top:0.5rem;padding-left:1.25rem;">${partnerHighlights.join('\n')}</ul></div>`;
    }

    return html;
}

// ── HTML rendering ──
function diffClass(val, key) {
    if (val === null || val === undefined || isNaN(val)) return 'neutral';
    const dir = METRIC_DIRECTION[key];
    if (dir === 'higher') return val > 0 ? 'better' : val < 0 ? 'worse' : 'neutral';
    return val < 0 ? 'better' : val > 0 ? 'worse' : 'neutral';
}

function diffStr(val) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    const sign = val > 0 ? '+' : '';
    return sign + fmt(val, 2);
}

function rowClass(type) {
    if (type === 'intuit') return 'highlight-row';
    if (type === 'partners_total') return 'pathedu-row';
    return '';
}

// volDenKey: which denominator to use for volume % (e.g. 'cst_den' or 'aht_den')
function renderOverallTable(id, title, tableData, metrics, volDenKey, volLabel) {
    const totalVol = tableData.reduce((s, r) => s + (r.type === 'partner' || r.type === 'intuit' ? (r.agg[volDenKey] || 0) : 0), 0);
    let html = `<h3 id="${id}">${title}</h3>\n<div class="card">\n<table>\n<thead><tr><th>Group</th>`;
    if (volDenKey) {
        html += `<th>${volLabel || 'Count'}</th><th>Vol %</th>`;
    }
    metrics.forEach(m => {
        html += `<th>${METRIC_LABELS[m]}</th>`;
        if (m === 'tnps') html += `<th>Surveys</th>`;
    });
    html += `</tr></thead>\n<tbody>\n`;
    tableData.forEach(row => {
        html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
        if (volDenKey) {
            const vol = row.agg[volDenKey] || 0;
            const pct = totalVol > 0 ? (vol / totalVol * 100) : 0;
            html += `<td>${fmtN(Math.round(vol))}</td><td>${fmt(pct, 1)}%</td>`;
        }
        metrics.forEach(m => {
            html += `<td>${metricVal(row.agg, m)}</td>`;
            if (m === 'tnps') html += `<td>${row.agg.tnps_den > 0 ? fmtN(Math.round(row.agg.tnps_den)) : '—'}</td>`;
        });
        html += `</tr>\n`;
    });
    html += `</tbody></table>\n</div>\n`;
    return html;
}

function renderBreakdownSection(id, title, breakdownObj, metrics, dimLabel) {
    const { dimValues, data: bData } = breakdownObj;
    let html = title ? `<h3 id="${id}">${title}</h3>\n` : '';
    dimValues.forEach(dv => {
        const rows = bData[dv];
        if (!rows || rows.length === 0) return;
        html += `<div class="card">\n<div class="card-header"><strong>${dimLabel}: ${dv}</strong></div>\n`;
        html += `<table>\n<thead><tr><th>Group</th>`;
        metrics.forEach(m => {
            html += `<th>${METRIC_LABELS[m]}</th>`;
            if (m === 'tnps') html += `<th>Surveys</th>`;
        });
        html += `</tr></thead>\n<tbody>\n`;
        rows.forEach(row => {
            html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
            metrics.forEach(m => {
                html += `<td>${metricVal(row.agg, m)}</td>`;
                if (m === 'tnps') html += `<td>${row.agg.tnps_den > 0 ? fmtN(Math.round(row.agg.tnps_den)) : '—'}</td>`;
            });
            html += `</tr>\n`;
        });
        html += `</tbody></table>\n</div>\n`;
    });
    return html;
}

// Inline table: metric-first grouping — columns = metric x dimValue
function renderInlineTable(id, title, inlineData, metrics, dimLabel) {
    const { dimValues, groups } = inlineData;
    let html = title ? `<h3 id="${id}">${title}</h3>\n` : '';
    html += `<div class="card">\n<table>\n<thead>`;
    html += `<tr><th rowspan="2">Group</th>`;
    metrics.forEach(m => {
        html += `<th colspan="${dimValues.length}" style="border-bottom:2px solid var(--primary);text-align:center;">${METRIC_LABELS[m]}</th>`;
    });
    html += `</tr>\n<tr>`;
    metrics.forEach(() => {
        dimValues.forEach(dv => { html += `<th>${dv}</th>`; });
    });
    html += `</tr></thead>\n<tbody>\n`;

    groups.forEach(g => {
        html += `<tr class="${rowClass(g.type)}"><td><strong>${g.name}</strong></td>`;
        metrics.forEach(m => {
            dimValues.forEach(dv => {
                const agg = g.aggs[dv];
                html += `<td>${agg ? metricVal(agg, m) : 'N/A'}</td>`;
            });
        });
        html += `</tr>\n`;
    });

    html += `</tbody></table>\n</div>\n`;
    return html;
}

// Map metric -> which denominator to use for volume % in period tables
const FS_METRIC_VOL = { tnps: 'tnps_den', ir: 'ir_den', sqs: 'cst_den', hc: 'hc_den', cst: 'cst_den' };
const TTLA_METRIC_VOL = { tnps: 'tnps_den', ir: 'ir_den', sqs: 'aht_den', aht: 'aht_den' };

// Period pivot with volume % row per metric
function renderPeriodPivot(id, title, tenureData, metrics, metricVolMap) {
    const { tenures, groups } = tenureData;
    let html = `<h3 id="${id}">${title}</h3>\n`;

    metrics.forEach(m => {
        const volKey = metricVolMap ? metricVolMap[m] : null;
        html += `<div class="card">\n<div class="card-header"><strong>${METRIC_LABELS[m]}</strong></div>\n`;
        html += `<table>\n<thead><tr><th>Group</th>`;
        tenures.forEach(t => { html += `<th>${t}</th>`; });
        html += `</tr></thead>\n<tbody>\n`;

        if (volKey) {
            const totalPerPeriod = {};
            tenures.forEach(t => {
                totalPerPeriod[t] = groups.reduce((s, g) => {
                    if (g.type === 'partners_total') return s;
                    const agg = g.aggs[t];
                    return s + (agg ? (agg[volKey] || 0) : 0);
                }, 0);
            });
            groups.forEach(g => {
                html += `<tr class="${rowClass(g.type)}" style="font-size:0.8rem;color:var(--muted);"><td>${g.name} <em>vol%</em></td>`;
                tenures.forEach(t => {
                    const agg = g.aggs[t];
                    const vol = agg ? (agg[volKey] || 0) : 0;
                    const total = totalPerPeriod[t];
                    const pct = total > 0 ? (vol / total * 100) : 0;
                    const label = g.type === 'partners_total' ? '' : (vol > 0 ? fmt(pct, 1) + '%' : '—');
                    html += `<td>${label}</td>`;
                });
                html += `</tr>\n`;
            });
            html += `<tr><td colspan="${tenures.length + 1}" style="height:2px;padding:0;background:var(--border);"></td></tr>\n`;
        }

        groups.forEach(g => {
            html += `<tr class="${rowClass(g.type)}"><td><strong>${g.name}</strong></td>`;
            tenures.forEach(t => {
                const agg = g.aggs[t];
                html += `<td>${agg ? metricVal(agg, m) : 'N/A'}</td>`;
            });
            html += `</tr>\n`;
        });

        html += `</tbody></table>\n</div>\n`;
    });

    return html;
}

// Dimension distribution table: rows = dimension values, columns = Overall% + per-partner %
function renderDimDistroTable(id, title, rows, dimField, volDenField, partnerList, dimOrder) {
    const pList = partnerList || PARTNERS_NON_INTUIT;
    const intuitRows = rows.filter(r => r.expert_partner_name === 'INTUIT');
    const allPartnerRows = rows.filter(r => pList.includes(r.expert_partner_name));
    const partnerGroups = {};
    pList.forEach(p => {
        const pr = rows.filter(r => r.expert_partner_name === p);
        if (pr.length > 0) partnerGroups[p] = pr;
    });

    let dimValues;
    if (dimOrder) {
        dimValues = dimOrder;
    } else {
        dimValues = [...new Set(rows.map(r => r[dimField]))].filter(v => v && v !== 'N/A').sort();
    }

    const sumDen = (rws) => rws.reduce((s, r) => s + pf(r[volDenField]), 0);

    const overallTotal = sumDen(rows);
    const intuitTotal = sumDen(intuitRows);
    const partnersTotal = sumDen(allPartnerRows);
    const partnerTotals = {};
    Object.entries(partnerGroups).forEach(([name, pr]) => { partnerTotals[name] = sumDen(pr); });

    const partnerNames = Object.keys(partnerGroups);

    let html = `<div class="card">\n<div class="card-header"><strong>${title}</strong></div>\n`;
    const dimColLabel = dimField === 'proficiency_level' ? 'PL' : dimField === 'expert_role' ? 'Role' : dimField === 'hire_type' ? 'Hire Type' : dimField === 'expert_tenure_category' ? 'Tenure' : dimField === 'reporting_period' ? 'Period' : 'Category';
    html += `<table>\n<thead><tr><th>${dimColLabel}</th><th>Overall %</th><th>Intuit %</th><th>Partners %</th>`;
    partnerNames.forEach(name => { html += `<th>${PARTNER_SHORT[name]} %</th>`; });
    html += `</tr></thead>\n<tbody>\n`;

    dimValues.forEach(dv => {
        let filterFn;
        if (dimField === 'proficiency_level' && dv === 'Other') {
            const knownPLs = ['PL1', 'PL2', 'PL3', 'PL4'];
            filterFn = r => !knownPLs.includes(r.proficiency_level);
        } else {
            filterFn = r => r[dimField] === dv;
        }

        const overallVol = sumDen(rows.filter(filterFn));
        const intuitVol = sumDen(intuitRows.filter(filterFn));
        const partnersVol = sumDen(allPartnerRows.filter(filterFn));

        const overallPct = overallTotal > 0 ? (overallVol / overallTotal * 100) : 0;
        const intuitPct = intuitTotal > 0 ? (intuitVol / intuitTotal * 100) : 0;
        const partnersPct = partnersTotal > 0 ? (partnersVol / partnersTotal * 100) : 0;

        html += `<tr><td><strong>${dv}</strong></td><td>${fmt(overallPct, 1)}%</td><td>${fmt(intuitPct, 1)}%</td><td>${fmt(partnersPct, 1)}%</td>`;
        partnerNames.forEach(name => {
            const pRows = partnerGroups[name] || [];
            const pVol = sumDen(pRows.filter(filterFn));
            const pTotal = partnerTotals[name] || 0;
            const pPct = pTotal > 0 ? (pVol / pTotal * 100) : 0;
            html += `<td>${pVol > 0 ? fmt(pPct, 1) + '%' : '—'}</td>`;
        });
        html += `</tr>\n`;
    });

    html += `</tbody></table>\n</div>\n`;
    return html;
}

// Tenure pivot: one table per metric, columns = tenure categories
function renderTenurePivot(id, title, tenureData, metrics) {
    const { tenures, groups } = tenureData;
    let html = title ? `<h3 id="${id}">${title}</h3>\n` : '';

    metrics.forEach(m => {
        html += `<div class="card">\n<div class="card-header"><strong>${METRIC_LABELS[m]}</strong></div>\n`;
        html += `<table>\n<thead><tr><th>Group</th>`;
        tenures.forEach(t => { html += `<th>${t}</th>`; });
        html += `</tr></thead>\n<tbody>\n`;

        groups.forEach(g => {
            html += `<tr class="${rowClass(g.type)}"><td><strong>${g.name}</strong></td>`;
            tenures.forEach(t => {
                const agg = g.aggs[t];
                html += `<td>${agg ? metricVal(agg, m) : 'N/A'}</td>`;
            });
            html += `</tr>\n`;
        });

        html += `</tbody></table>\n</div>\n`;
    });

    return html;
}

function renderKPIs(tableData, metrics) {
    const intuitRow = tableData.find(r => r.type === 'intuit');
    const partnersTotalRow = tableData.find(r => r.type === 'partners_total');
    if (!intuitRow || !partnersTotalRow) return '';

    let html = '<div class="kpi-row">\n';
    metrics.forEach(m => {
        const pVal = partnersTotalRow.agg[m];
        const iVal = intuitRow.agg[m];
        if (pVal === null || iVal === null) return;
        const diff = pVal - iVal;
        const cls = diffClass(diff, m);
        const colorCls = cls === 'better' ? 'green' : cls === 'worse' ? 'red' : 'blue';
        html += `<div class="kpi ${colorCls}">
    <div class="label">Partners Total ${METRIC_LABELS[m]}</div>
    <div class="value">${fmt(pVal, 2)}</div>
    <div class="detail">vs Intuit ${fmt(iVal, 2)} (${diffStr(diff)})</div>
</div>\n`;
    });
    html += '</div>\n';
    return html;
}

function buildOverallCharts(prefix, tableData, metrics) {
    let js = '';
    const labels = tableData.map(r => r.name);
    const chartColors = [
        { bg: 'rgba(37,99,235,0.7)', border: '#2563eb' },
        { bg: 'rgba(124,58,237,0.7)', border: '#7c3aed' },
        { bg: 'rgba(13,148,136,0.7)', border: '#0d9488' },
        { bg: 'rgba(217,119,6,0.7)', border: '#d97706' },
        { bg: 'rgba(22,163,74,0.7)', border: '#16a34a' },
        { bg: 'rgba(220,38,38,0.7)', border: '#dc2626' },
        { bg: 'rgba(99,102,241,0.7)', border: '#6366f1' },
    ];

    metrics.forEach(m => {
        const id = `${prefix}_${m}`;
        const bgArr = tableData.map((r, i) => r.type === 'intuit' ? 'rgba(99,102,241,0.7)' : r.type === 'partners_total' ? 'rgba(22,163,74,0.7)' : chartColors[i % chartColors.length].bg);
        const borderArr = tableData.map((r, i) => r.type === 'intuit' ? '#6366f1' : r.type === 'partners_total' ? '#16a34a' : chartColors[i % chartColors.length].border);

        js += `new Chart(document.getElementById('${id}'), {
        type: 'bar',
        data: {
            labels: [${labels.map(l => `'${l}'`).join(',')}],
            datasets: [{
                label: '${METRIC_LABELS[m]}',
                data: [${tableData.map(r => r.agg[m] === null ? 'null' : r.agg[m].toFixed(4)).join(',')}],
                backgroundColor: [${bgArr.map(c => `'${c}'`).join(',')}],
                borderColor: [${borderArr.map(c => `'${c}'`).join(',')}],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false }, title: { display: true, text: '${METRIC_LABELS[m]}' } },
            scales: { y: { beginAtZero: false } }
        }
    });\n`;
    });
    return js;
}

function buildCallout(label, tableData, metrics) {
    const intuit = tableData.find(r => r.type === 'intuit');
    const pTotal = tableData.find(r => r.type === 'partners_total');
    if (!intuit || !pTotal) return '';

    let items = [];
    metrics.forEach(m => {
        if (pTotal.agg[m] === null || intuit.agg[m] === null) return;
        const diff = pTotal.agg[m] - intuit.agg[m];
        const dir = METRIC_DIRECTION[m];
        const better = (dir === 'higher' && diff > 0) || (dir === 'lower' && diff < 0);
        const word = better ? 'better' : 'worse';
        items.push(`<strong>${METRIC_LABELS[m]}:</strong> Partners Total ${fmt(pTotal.agg[m], 2)} vs Intuit ${fmt(intuit.agg[m], 2)} (${diffStr(diff)}) — <span class="${word}">${word}</span>`);
    });

    const overallBetter = items.filter(i => i.includes('class="better"')).length;
    const cls = overallBetter > items.length / 2 ? 'success' : overallBetter === 0 ? 'danger' : '';

    return `<div class="callout ${cls}">
    <strong>${label} — Partners Total vs Intuit:</strong>
    <ul style="margin-top:0.5rem;padding-left:1.25rem;">${items.map(i => `<li>${i}</li>`).join('\n')}</ul>
</div>\n`;
}

function addKPI(label, pVal, iVal, key) {
    if (pVal === null || iVal === null) return '';
    const diff = pVal - iVal;
    const cls = diffClass(diff, key);
    const c = cls === 'better' ? 'green' : cls === 'worse' ? 'red' : 'blue';
    return `<div class="kpi ${c}">
    <div class="label">${label}</div>
    <div class="value">${fmt(pVal, 2)}</div>
    <div class="detail">vs Intuit ${fmt(iVal, 2)} (${diffStr(diff)})</div>
</div>\n`;
}

function buildConclusions(product, tableData, metrics) {
    const intuit = tableData.find(r => r.type === 'intuit');
    const pTotal = tableData.find(r => r.type === 'partners_total');
    if (!intuit || !pTotal) return '';

    let items = [];
    metrics.forEach(m => {
        if (pTotal.agg[m] === null || intuit.agg[m] === null) return;
        const diff = pTotal.agg[m] - intuit.agg[m];
        const dir = METRIC_DIRECTION[m];
        const better = (dir === 'higher' && diff > 0) || (dir === 'lower' && diff < 0);
        const pctDiff = intuit.agg[m] !== 0 ? ((diff / Math.abs(intuit.agg[m])) * 100).toFixed(1) : 'N/A';
        items.push({ metric: METRIC_LABELS[m], pVal: pTotal.agg[m], iVal: intuit.agg[m], diff, better, pctDiff });
    });

    let h = `<div class="card"><h3 style="margin-top:0;">${product} Summary</h3><ul style="padding-left:1.25rem;">\n`;
    items.forEach(i => {
        const cls = i.better ? 'better' : 'worse';
        h += `<li><strong>${i.metric}:</strong> Partners Total <strong>${fmt(i.pVal, 2)}</strong> vs Intuit <strong>${fmt(i.iVal, 2)}</strong> &mdash; <span class="${cls}">${i.better ? 'Partners outperform' : 'Intuit outperforms'} by ${Math.abs(i.diff).toFixed(2)} (${Math.abs(parseFloat(i.pctDiff)).toFixed(1)}%)</span></li>\n`;
    });
    h += '</ul></div>\n';

    const partners = tableData.filter(r => r.type === 'partner');
    if (partners.length > 0) {
        h += `<div class="card"><h3 style="margin-top:0;">${product} — Partner Highlights</h3><table>\n<thead><tr><th>Partner</th>`;
        metrics.forEach(m => { h += `<th>${METRIC_LABELS[m]}</th>`; });
        h += `<th>Strengths</th><th>Surveys</th></tr></thead><tbody>\n`;

        partners.forEach(p => {
            h += `<tr><td><strong>${p.name}</strong></td>`;
            let strengths = [];
            metrics.forEach(m => {
                h += `<td>${metricVal(p.agg, m)}</td>`;
                if (p.agg[m] !== null && intuit.agg[m] !== null) {
                    const diff = p.agg[m] - intuit.agg[m];
                    const dir = METRIC_DIRECTION[m];
                    if ((dir === 'higher' && diff > 0) || (dir === 'lower' && diff < 0)) strengths.push(METRIC_LABELS[m]);
                }
            });
            h += `<td>${strengths.length > 0 ? strengths.map(s => `<span class="badge badge-green">${s}</span>`).join(' ') : '<span class="badge badge-yellow">Below Intuit</span>'}</td>`;
            h += `<td>${p.agg.tnps_den > 0 ? fmtN(Math.round(p.agg.tnps_den)) : '—'}</td></tr>\n`;
        });
        h += '</tbody></table></div>\n';
    }
    return h;
}

// ── Volume distribution rendering ──
function buildVolumeData(tableData, volKey) {
    const partners = tableData.filter(r => r.type === 'partner');
    const pTotal = tableData.find(r => r.type === 'partners_total');
    const intuit = tableData.find(r => r.type === 'intuit');

    const partnerVols = partners.map(p => ({ name: p.name, vol: Math.round(p.agg[volKey]) }));
    const partnersTotal = pTotal ? Math.round(pTotal.agg[volKey]) : 0;
    const intuitTotal = intuit ? Math.round(intuit.agg[volKey]) : 0;
    const grandTotal = partnersTotal + intuitTotal;

    return { partnerVols, partnersTotal, intuitTotal, grandTotal };
}

function renderVolumeSection(prefix, title, volLabel, tableData, volKey) {
    const { partnerVols, partnersTotal, intuitTotal, grandTotal } = buildVolumeData(tableData, volKey);

    let html = `<h3 id="${prefix}-volume">${title}</h3>\n`;

    // KPI tiles: Intuit vs Partners Total
    const intuitPct = grandTotal > 0 ? (intuitTotal / grandTotal * 100) : 0;
    const partnersPct = grandTotal > 0 ? (partnersTotal / grandTotal * 100) : 0;
    html += `<div class="kpi-row">
<div class="kpi blue">
    <div class="label">Total ${volLabel}</div>
    <div class="value">${fmtN(grandTotal)}</div>
    <div class="detail">Intuit + All Partners</div>
</div>
<div class="kpi purple">
    <div class="label">Intuit</div>
    <div class="value">${fmt(intuitPct, 1)}%</div>
    <div class="detail">${fmtN(intuitTotal)} ${volLabel}</div>
</div>
<div class="kpi teal">
    <div class="label">Partners Total</div>
    <div class="value">${fmt(partnersPct, 1)}%</div>
    <div class="detail">${fmtN(partnersTotal)} ${volLabel}</div>
</div>
</div>\n`;

    // Partner breakdown table
    html += `<div class="card">
<div class="card-header"><strong>${volLabel} Distribution by Partner</strong></div>
<table>
<thead><tr><th>Group</th><th>${volLabel}</th><th>% of Partners</th><th>% of Total</th></tr></thead>
<tbody>\n`;

    partnerVols.forEach(p => {
        const pctOfPartners = partnersTotal > 0 ? (p.vol / partnersTotal * 100) : 0;
        const pctOfTotal = grandTotal > 0 ? (p.vol / grandTotal * 100) : 0;
        html += `<tr><td><strong>${p.name}</strong></td><td>${fmtN(p.vol)}</td><td>${fmt(pctOfPartners, 1)}%</td><td>${fmt(pctOfTotal, 1)}%</td></tr>\n`;
    });

    html += `<tr class="pathedu-row"><td><strong>Partners Total</strong></td><td>${fmtN(partnersTotal)}</td><td>100.0%</td><td>${fmt(partnersPct, 1)}%</td></tr>\n`;
    html += `<tr class="highlight-row"><td><strong>Intuit</strong></td><td>${fmtN(intuitTotal)}</td><td>—</td><td>${fmt(intuitPct, 1)}%</td></tr>\n`;

    html += `</tbody></table>
</div>\n`;

    // Two charts: Intuit vs Partners pie, and partner-level pie
    const pieId1 = `${prefix}_vol_split`;
    const pieId2 = `${prefix}_vol_partners`;
    html += `<div class="chart-row">
    <div class="chart-box"><h3 style="margin-top:0;">Intuit vs Partners — ${volLabel}</h3><canvas id="${pieId1}" height="280"></canvas></div>
    <div class="chart-box"><h3 style="margin-top:0;">Partner ${volLabel} Breakdown</h3><canvas id="${pieId2}" height="280"></canvas></div>
</div>\n`;

    return { html, pieId1, pieId2, partnerVols, partnersTotal, intuitTotal };
}

function buildVolumeCharts(vol) {
    const { pieId1, pieId2, partnerVols, partnersTotal, intuitTotal } = vol;
    let js = '';

    js += `new Chart(document.getElementById('${pieId1}'), {
        type: 'doughnut',
        data: {
            labels: ['Intuit', 'Partners Total'],
            datasets: [{
                data: [${intuitTotal}, ${partnersTotal}],
                backgroundColor: ['rgba(99,102,241,0.75)', 'rgba(22,163,74,0.75)'],
                borderColor: ['#6366f1', '#16a34a'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: function(ctx) { var total = ctx.dataset.data.reduce(function(a,b){return a+b},0); var pct = (ctx.parsed / total * 100).toFixed(1); return ctx.label + ': ' + ctx.parsed.toLocaleString() + ' (' + pct + '%)'; } } }
            }
        }
    });\n`;

    const pColors = [
        'rgba(37,99,235,0.75)', 'rgba(124,58,237,0.75)', 'rgba(13,148,136,0.75)',
        'rgba(217,119,6,0.75)', 'rgba(220,38,38,0.75)', 'rgba(99,102,241,0.75)'
    ];
    const pBorders = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#dc2626', '#6366f1'];

    js += `new Chart(document.getElementById('${pieId2}'), {
        type: 'doughnut',
        data: {
            labels: [${partnerVols.map(p => `'${p.name}'`).join(',')}],
            datasets: [{
                data: [${partnerVols.map(p => p.vol).join(',')}],
                backgroundColor: [${partnerVols.map((_, i) => `'${pColors[i % pColors.length]}'`).join(',')}],
                borderColor: [${partnerVols.map((_, i) => `'${pBorders[i % pBorders.length]}'`).join(',')}],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: function(ctx) { var total = ctx.dataset.data.reduce(function(a,b){return a+b},0); var pct = (ctx.parsed / total * 100).toFixed(1); return ctx.label + ': ' + ctx.parsed.toLocaleString() + ' (' + pct + '%)'; } } }
            }
        }
    });\n`;

    return js;
}

function orderBreakdownDims(breakdown, order) {
    const present = order.filter(d => breakdown.dimValues.includes(d));
    const rest = breakdown.dimValues.filter(d => !order.includes(d)).sort();
    breakdown.dimValues = [...present, ...rest];
}
orderBreakdownDims(fsByAttr, ATTR_ORDER);
orderBreakdownDims(ttlaByAttr, ATTR_ORDER);

function renderSkuMixSection(prefix, title, tableData) {
    let html = `<h3 id="${prefix}-sku">${title}</h3>\n`;
    html += `<p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;">SKU mix shows the share of FS engagements by product tier (Basic, Deluxe, Premium). A higher Basic share generally means a less complex workload and lower blended CST. Compare partner mix vs Intuit to assess whether performance gaps may reflect assignment differences rather than execution quality.</p>\n`;

    html += `<div class="card"><div class="card-header"><strong>Engagement Mix by SKU (%)</strong></div><table>
<thead><tr><th>Group</th><th>Engagements</th><th>Basic %</th><th>Deluxe %</th><th>Premium %</th></tr></thead><tbody>\n`;

    tableData.forEach(row => {
        const total = row.agg.sku_total || 0;
        html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
        html += `<td>${total > 0 ? fmtN(Math.round(total)) : '—'}</td>`;
        html += `<td>${row.agg.sku_basic_pct !== null ? fmt(row.agg.sku_basic_pct, 1) + '%' : '—'}</td>`;
        html += `<td>${row.agg.sku_deluxe_pct !== null ? fmt(row.agg.sku_deluxe_pct, 1) + '%' : '—'}</td>`;
        html += `<td>${row.agg.sku_premium_pct !== null ? fmt(row.agg.sku_premium_pct, 1) + '%' : '—'}</td></tr>\n`;
    });
    html += `</tbody></table></div>\n`;

    html += `<div class="card"><div class="card-header"><strong>Blended CST by SKU (hours per engagement)</strong></div><table>
<thead><tr><th>Group</th><th>Basic CST</th><th>Deluxe CST</th><th>Premium CST</th><th>Overall CST</th></tr></thead><tbody>\n`;
    tableData.forEach(row => {
        html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
        html += `<td>${metricVal(row.agg, 'cst_basic')}</td>`;
        html += `<td>${metricVal(row.agg, 'cst_deluxe')}</td>`;
        html += `<td>${metricVal(row.agg, 'cst_premium')}</td>`;
        html += `<td>${metricVal(row.agg, 'cst')}</td></tr>\n`;
    });
    html += `</tbody></table></div>\n`;

    const pTotal = tableData.find(r => r.type === 'partners_total');
    const intuit = tableData.find(r => r.type === 'intuit');
    if (pTotal && intuit && pTotal.agg.sku_basic_pct !== null && intuit.agg.sku_basic_pct !== null) {
        const basicDiff = pTotal.agg.sku_basic_pct - intuit.agg.sku_basic_pct;
        const premDiff = pTotal.agg.sku_premium_pct - intuit.agg.sku_premium_pct;
        const easierMix = basicDiff > 2 || premDiff < -2;
        const cls = easierMix ? 'warning' : 'success';
        html += `<div class="callout ${cls === 'warning' ? '' : 'success'}">
    <strong>SKU Mix Insight:</strong> Partners Total has <strong>${fmt(pTotal.agg.sku_basic_pct, 1)}%</strong> Basic vs Intuit <strong>${fmt(intuit.agg.sku_basic_pct, 1)}%</strong> (${diffStr(basicDiff)} pp), and <strong>${fmt(pTotal.agg.sku_premium_pct, 1)}%</strong> Premium vs Intuit <strong>${fmt(intuit.agg.sku_premium_pct, 1)}%</strong> (${diffStr(premDiff)} pp).
    ${easierMix ? 'Partners handle a <strong>more Basic-heavy mix</strong>, which may partially explain CST advantages but also means tNPS/HC comparisons should be interpreted in context of workload complexity.' : 'Partner and Intuit SKU mixes are broadly comparable — performance differences are less likely driven by assignment mix alone.'}
</div>\n`;
    }

    html += `<div class="chart-row">
    <div class="chart-box"><h3 style="margin-top:0;">SKU Mix — Partners vs Intuit</h3><canvas id="${prefix}_sku_mix" height="300"></canvas></div>
    <div class="chart-box"><h3 style="margin-top:0;">CST by SKU Tier</h3><canvas id="${prefix}_sku_cst" height="300"></canvas></div>
</div>\n`;
    return html;
}

function buildSkuMixCharts(prefix, tableData) {
    const compareRows = tableData.filter(r => r.type === 'partners_total' || r.type === 'intuit');
    if (compareRows.length < 2) return '';
    const labels = compareRows.map(r => r.name);
    return `new Chart(document.getElementById('${prefix}_sku_mix'), {
        type: 'bar',
        data: {
            labels: [${labels.map(l => `'${l}'`).join(',')}],
            datasets: [
                { label: 'Basic %', data: [${compareRows.map(r => r.agg.sku_basic_pct?.toFixed(2) ?? 'null').join(',')}], backgroundColor: 'rgba(37,99,235,0.75)' },
                { label: 'Deluxe %', data: [${compareRows.map(r => r.agg.sku_deluxe_pct?.toFixed(2) ?? 'null').join(',')}], backgroundColor: 'rgba(124,58,237,0.75)' },
                { label: 'Premium %', data: [${compareRows.map(r => r.agg.sku_premium_pct?.toFixed(2) ?? 'null').join(',')}], backgroundColor: 'rgba(217,119,6,0.75)' }
            ]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, max: 100, title: { display: true, text: '% Engagements' } } } }
    });
new Chart(document.getElementById('${prefix}_sku_cst'), {
        type: 'bar',
        data: {
            labels: [${labels.map(l => `'${l}'`).join(',')}],
            datasets: [
                { label: 'Basic CST', data: [${compareRows.map(r => r.agg.cst_basic?.toFixed(2) ?? 'null').join(',')}], backgroundColor: 'rgba(37,99,235,0.7)' },
                { label: 'Deluxe CST', data: [${compareRows.map(r => r.agg.cst_deluxe?.toFixed(2) ?? 'null').join(',')}], backgroundColor: 'rgba(124,58,237,0.7)' },
                { label: 'Premium CST', data: [${compareRows.map(r => r.agg.cst_premium?.toFixed(2) ?? 'null').join(',')}], backgroundColor: 'rgba(217,119,6,0.7)' }
            ]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { title: { display: true, text: 'Hours' } } } }
    });\n`;
}

function metricInsight(label, pVal, iVal, key) {
    if (pVal === null || iVal === null) return '';
    const diff = pVal - iVal;
    const dir = METRIC_DIRECTION[key];
    const better = (dir === 'higher' && diff > 0) || (dir === 'lower' && diff < 0);
    const pct = iVal !== 0 ? Math.abs((diff / Math.abs(iVal)) * 100).toFixed(1) : 'N/A';
    const cls = better ? 'better' : 'worse';
    const word = better ? 'outperforms' : 'underperforms';
    return `<li><strong>${label}:</strong> Partners <strong>${fmt(pVal, 2)}</strong> vs Intuit <strong>${fmt(iVal, 2)}</strong> — <span class="${cls}">Partners ${word} by ${Math.abs(diff).toFixed(2)} (${pct}%)</span></li>`;
}

function buildExpandedExecSummary() {
    const fsP = fsOverall.find(r => r.type === 'partners_total');
    const fsI = fsOverall.find(r => r.type === 'intuit');
    const ttlaP = ttlaOverall.find(r => r.type === 'partners_total');
    const ttlaI = ttlaOverall.find(r => r.type === 'intuit');

    let html = `<p>This analysis compares <strong>Domain Partners</strong> (${PARTNERS_NON_INTUIT.map(p => PARTNER_SHORT[p]).join(', ')}) against <strong>Intuit</strong> across two products: <strong>TTL Full Service Consumer (FS)</strong> and <strong>TTL Assisted Consumer (TTLA)</strong>. Each metric is computed as <code>sum(numerator) / sum(denominator)</code> — a volume-weighted approach that reflects actual workload rather than simple averages.</p>

<p style="font-size:0.9rem;color:var(--muted);margin:0.75rem 0;">Partners analyzed: ${PARTNERS_NON_INTUIT.map(p => `<strong>${PARTNER_SHORT[p]}</strong> (${p})`).join(', ')}. Intuit rows include all Intuit-sourced experts. Foundever appears in FS only; EAW, Highspring, JDA, and Magnit serve both products.</p>

<h3>FS Performance Story</h3>
<p>On Full Service, Domain Partners collectively deliver <strong>stronger customer satisfaction and operational efficiency</strong> than Intuit. Partners Total tNPS of <strong>${fsP ? fmt(fsP.agg.tnps, 2) : 'N/A'}</strong> exceeds Intuit's <strong>${fsI ? fmt(fsI.agg.tnps, 2) : 'N/A'}</strong>${fsP && fsI ? ` (+${(fsP.agg.tnps - fsI.agg.tnps).toFixed(2)} points)` : ''}, based on ${fsP ? fmtN(Math.round(fsP.agg.tnps_den)) : '—'} partner surveys. Handled Conversion (HC) and Customer Service Time (CST) also favor partners — suggesting partners convert engagements effectively while spending less time per return. However, partners handle a ${fsP && fsP.agg.sku_basic_pct > (fsI?.agg.sku_basic_pct || 0) + 2 ? 'somewhat more Basic-heavy' : ' broadly comparable'} SKU mix, which affects blended CST comparisons.</p>

<h3>TTLA Performance Story</h3>
<p>TTL Assisted tells a different story. Intuit outperforms partners on <strong>tNPS, Issue Resolution (IR), and Service Quality Score (SQS)</strong>, while AHT is roughly comparable. Partners Total tNPS of <strong>${ttlaP ? fmt(ttlaP.agg.tnps, 2) : 'N/A'}</strong> trails Intuit's <strong>${ttlaI ? fmt(ttlaI.agg.tnps, 2) : 'N/A'}</strong>${ttlaP && ttlaI ? ` by ${(ttlaI.agg.tnps - ttlaP.agg.tnps).toFixed(2)} points` : ''} across ${ttlaP ? fmtN(Math.round(ttlaP.agg.tnps_den)) : '—'} surveys. JDA dominates partner TTLA volume (~${ttlaOverall.find(r => r.name === 'JDA') ? fmt(ttlaOverall.find(r => r.name === 'JDA').agg.aht_den / ttlaP.agg.aht_den * 100, 0) : '—'}%), so aggregate partner metrics are heavily influenced by JDA's performance profile.</p>

<h3>Key Metrics at a Glance</h3>\n`;
    return html;
}

function buildExecutiveSummaryBlock(headingId, sectionNumber) {
    const fsP = fsOverall.find(r => r.type === 'partners_total');
    const fsI = fsOverall.find(r => r.type === 'intuit');
    const ttlaP = ttlaOverall.find(r => r.type === 'partners_total');
    const ttlaI = ttlaOverall.find(r => r.type === 'intuit');

    const title = sectionNumber ? `${sectionNumber}. Executive Summary` : 'Executive Summary';
    const idAttr = headingId ? ` id="${headingId}"` : ' style="margin-top:0;"';
    let html = `<h2${idAttr}>${title}</h2>\n`;
    html += buildExpandedExecSummary();

    html += '<div class="kpi-row">\n';
    if (fsP && fsI) {
        html += addKPI('FS tNPS', fsP.agg.tnps, fsI.agg.tnps, 'tnps');
        html += addKPI('FS HC', fsP.agg.hc, fsI.agg.hc, 'hc');
        html += addKPI('FS CST', fsP.agg.cst, fsI.agg.cst, 'cst');
    }
    if (ttlaP && ttlaI) {
        html += addKPI('TTLA tNPS', ttlaP.agg.tnps, ttlaI.agg.tnps, 'tnps');
        html += addKPI('TTLA AHT', ttlaP.agg.aht, ttlaI.agg.aht, 'aht');
        html += addKPI('TTLA IR', ttlaP.agg.ir, ttlaI.agg.ir, 'ir');
    }
    html += '</div>\n';

    html += buildCallout('FS Overview', fsOverall, FS_METRICS);
    html += buildCallout('TTLA Overview', ttlaOverall, TTLA_METRICS);
    return html;
}

function buildSummaryTab(fsTable, ttlaTable, fsVolData, ttlaVolData) {
    const fsP = fsTable.find(r => r.type === 'partners_total');
    const fsI = fsTable.find(r => r.type === 'intuit');

    let html = buildExecutiveSummaryBlock('');

    if (fsP && fsI && fsP.agg.sku_basic_pct !== null) {
        const basicDiff = fsP.agg.sku_basic_pct - fsI.agg.sku_basic_pct;
        html += `<div class="callout teal"><strong>SKU Mix Context (FS):</strong> Partners handle ${fmt(fsP.agg.sku_basic_pct, 1)}% Basic engagements vs ${fmt(fsI.agg.sku_basic_pct, 1)}% for Intuit (${diffStr(basicDiff)} pp). ${basicDiff > 2 ? 'The partner mix skews more Basic — a potentially easier workload that should be considered when interpreting CST and conversion metrics.' : 'SKU mix is comparable to Intuit, supporting apples-to-apples performance comparisons.'}</div>`;
    }

    html += buildDrillDownInsights();

    html += `<h3>Volume &amp; Scale</h3>
<div class="kpi-row">
<div class="kpi blue"><div class="label">FS Engagements</div><div class="value">${fmtN(fsVolData.grandTotal)}</div><div class="detail">Partners ${fmt(fsVolData.partnersTotal / fsVolData.grandTotal * 100, 1)}% · Intuit ${fmt(fsVolData.intuitTotal / fsVolData.grandTotal * 100, 1)}%</div></div>
<div class="kpi purple"><div class="label">TTLA Contacts</div><div class="value">${fmtN(ttlaVolData.grandTotal)}</div><div class="detail">Partners ${fmt(ttlaVolData.partnersTotal / ttlaVolData.grandTotal * 100, 1)}% · Intuit ${fmt(ttlaVolData.intuitTotal / ttlaVolData.grandTotal * 100, 1)}%</div></div>
</div>
<ul style="padding-left:1.25rem;margin-bottom:1rem;">
<li><strong>FS:</strong> ${fmtN(fsVolData.partnersTotal)} partner engagements (${fmt(fsVolData.partnersTotal / fsVolData.grandTotal * 100, 1)}% of ${fmtN(fsVolData.grandTotal)} total)</li>
<li><strong>TTLA:</strong> ${fmtN(ttlaVolData.partnersTotal)} partner contacts (${fmt(ttlaVolData.partnersTotal / ttlaVolData.grandTotal * 100, 1)}% of ${fmtN(ttlaVolData.grandTotal)} total)</li>
<li><strong>Survey base:</strong> ${fsP ? fmtN(Math.round(fsP.agg.tnps_den)) : '—'} FS partner surveys · ${ttlaTable.find(r => r.type === 'partners_total') ? fmtN(Math.round(ttlaTable.find(r => r.type === 'partners_total').agg.tnps_den)) : '—'} TTLA partner surveys</li>
</ul>

<h3>What to Watch</h3>
<ul style="padding-left:1.25rem;">
<li><strong>Attrition lens:</strong> Active vs attrited cohorts may show different performance profiles — see Attrition Status breakdowns in the Analisys tab.</li>
<li><strong>Partner variation:</strong> Individual partner performance varies widely; JDA carries the largest TTLA volume share while Foundever has minimal FS presence.</li>
<li><strong>Mix-adjusted interpretation:</strong> See the <a href="#appendix-mix">Appendix</a> — partners are reweighted to Intuit's workload mix to isolate execution vs. assignment effects.</li>
</ul>

<p style="font-size:0.85rem;color:var(--muted);margin-top:1.5rem;">See the <strong>Analisys</strong> tab for full breakdowns by reporting period, role, proficiency level, hire type, attrition status, and detailed partner-level tables.</p>`;
    return html;
}

// ══════════════════════════════════════════
// BUILD HTML — FS first, then TTLA
// ══════════════════════════════════════════
const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
let chartJS = '';

const ttlaIntuit = ttlaOverall.find(r => r.type === 'intuit');
const ttlaPartners = ttlaOverall.find(r => r.type === 'partners_total');
const fsIntuit = fsOverall.find(r => r.type === 'intuit');
const fsPartners = fsOverall.find(r => r.type === 'partners_total');

let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Domain Partners Performance Analysis</title>
    <style>
        :root {
            --bg: #f8f9fa; --card: #ffffff; --border: #dee2e6; --text: #212529; --muted: #6c757d;
            --primary: #2563eb; --primary-light: #dbeafe;
            --success: #16a34a; --success-light: #dcfce7;
            --danger: #dc2626; --danger-light: #fee2e2;
            --warning: #d97706; --warning-light: #fef3c7;
            --purple: #7c3aed; --purple-light: #ede9fe;
            --teal: #0d9488; --teal-light: #ccfbf1;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
        .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
        h1 { font-size: 2rem; margin-bottom: 0.25rem; }
        h2 { font-size: 1.5rem; margin: 2.5rem 0 1rem; border-bottom: 2px solid var(--primary); padding-bottom: 0.5rem; }
        h3 { font-size: 1.15rem; margin: 1.5rem 0 0.75rem; color: var(--primary); }
        .subtitle { color: var(--muted); margin-bottom: 2rem; }
        .report-date { color: var(--muted); font-size: 0.9rem; }
        .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
        .kpi { background: var(--card); border-radius: 10px; padding: 1.25rem; border: 1px solid var(--border); text-align: center; }
        .kpi .label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 0.35rem; }
        .kpi .value { font-size: 2rem; font-weight: 700; }
        .kpi .detail { font-size: 0.82rem; color: var(--muted); margin-top: 0.25rem; }
        .kpi.green .value { color: var(--success); }
        .kpi.red .value { color: var(--danger); }
        .kpi.blue .value { color: var(--primary); }
        .kpi.purple .value { color: var(--purple); }
        .kpi.teal .value { color: var(--teal); }
        .card { background: var(--card); border-radius: 10px; padding: 1.5rem; border: 1px solid var(--border); margin-bottom: 1.5rem; }
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
        .badge { display: inline-block; padding: 0.2rem 0.65rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
        .badge-green { background: var(--success-light); color: var(--success); }
        .badge-red { background: var(--danger-light); color: var(--danger); }
        .badge-yellow { background: var(--warning-light); color: var(--warning); }
        .badge-blue { background: var(--primary-light); color: var(--primary); }
        table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin: 0.75rem 0; }
        th, td { padding: 0.55rem 0.75rem; text-align: center; border-bottom: 1px solid var(--border); }
        th { background: #f1f5f9; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.04em; color: var(--muted); }
        td:first-child, th:first-child { text-align: left; }
        tr:hover td { background: #f8fafc; }
        .highlight-row td { background: var(--primary-light) !important; font-weight: 600; }
        .pathedu-row td { background: #f0fdf4 !important; font-weight: 600; }
        .better { color: var(--success); font-weight: 600; }
        .worse { color: var(--danger); font-weight: 600; }
        .neutral { color: var(--muted); }
        .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 1.5rem 0; }
        .chart-box { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; }
        .chart-box canvas { width: 100% !important; }
        @media (max-width: 900px) { .chart-row { grid-template-columns: 1fr; } }
        .callout { border-left: 4px solid var(--primary); background: var(--primary-light); padding: 1rem 1.25rem; border-radius: 0 8px 8px 0; margin: 1rem 0; font-size: 0.92rem; }
        .callout.success { border-left-color: var(--success); background: var(--success-light); }
        .callout.danger { border-left-color: var(--danger); background: var(--danger-light); }
        .callout.teal { border-left-color: var(--teal); background: var(--teal-light); }
        .toc { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem 2rem; margin: 1.5rem 0; }
        .toc ol { padding-left: 1.25rem; }
        .toc li { margin-bottom: 0.35rem; }
        .toc a { color: var(--primary); text-decoration: none; }
        .toc a:hover { text-decoration: underline; }
        footer { text-align: center; padding: 2rem 0; color: var(--muted); font-size: 0.82rem; border-top: 1px solid var(--border); margin-top: 3rem; }
        .section-divider { border: none; height: 3px; background: linear-gradient(90deg, var(--primary), var(--purple)); margin: 3rem 0; border-radius: 2px; }
        .tabs { display: flex; gap: 4px; margin: 1.5rem 0 2rem; background: #f1f5f9; border: 1px solid var(--border); border-radius: 10px; padding: 4px; width: fit-content; flex-wrap: wrap; }
        .tab { padding: 0.65rem 1.35rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; color: var(--muted); transition: all 0.2s; border: none; background: transparent; }
        .tab:hover { color: var(--text); }
        .tab.active { background: var(--primary); color: #fff; }
        .section { display: none; }
        .section.active { display: block; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
</head>
<body>
<div class="container">

    <h1>Domain Partners Performance Analysis</h1>
    <p class="subtitle">Partner vs Intuit Expert Performance &bull; Full Service &amp; TTLA</p>
    <p class="report-date">Report generated: ${today}</p>

    <div class="tabs">
        <button class="tab active" data-tab="summary">Summary</button>
        <button class="tab" data-tab="analisys">Analisys</button>
    </div>

    <div class="section active" id="sec-summary">
        ${buildSummaryTab(fsOverall, ttlaOverall, buildVolumeData(fsOverall, 'cst_den'), buildVolumeData(ttlaOverall, 'aht_den'))}
    </div>

    <div class="section" id="sec-analisys">

    <div class="toc">
        <strong>Contents</strong>
        <ol>
            <li><a href="#exec">Executive Summary</a></li>
            <li><a href="#fs">FS (TTL Full Service Consumer) Analysis</a>
                <ol style="list-style-type: lower-alpha; padding-left: 1rem;">
                    <li><a href="#fs-volume">Volume Distribution</a></li>
                    <li><a href="#fs-sku">SKU Mix Analysis</a></li>
                    <li><a href="#fs-overall">Overall Performance</a></li>
                    <li><a href="#fs-period">Breakdown by Reporting Period</a></li>
                    <li><a href="#fs-role">Breakdown by Expert Role</a></li>
                    <li><a href="#fs-pl">Breakdown by Proficiency Level</a></li>
                    <li><a href="#fs-hire">Breakdown by Hire Type</a></li>
                    <li><a href="#fs-attr">Breakdown by Attrition Status</a></li>
                    ${hasTenure ? '<li><a href="#fs-tenure">Breakdown by Tenure Category</a></li>' : ''}
                </ol>
            </li>
            <li><a href="#ttla">TTLA (TTL Assisted Consumer) Analysis</a>
                <ol style="list-style-type: lower-alpha; padding-left: 1rem;">
                    <li><a href="#ttla-volume">Volume Distribution</a></li>
                    <li><a href="#ttla-overall">Overall Performance</a></li>
                    <li><a href="#ttla-period">Breakdown by Reporting Period</a></li>
                    <li><a href="#ttla-role">Breakdown by Expert Role</a></li>
                    <li><a href="#ttla-pl">Breakdown by Proficiency Level</a></li>
                    ${hasContactType ? '<li><a href="#ttla-ct">Breakdown by Contact Type</a></li>' : ''}
                    <li><a href="#ttla-hire">Breakdown by Hire Type</a></li>
                    <li><a href="#ttla-attr">Breakdown by Attrition Status</a></li>
                    ${hasTenure ? '<li><a href="#ttla-tenure">Breakdown by Tenure Category</a></li>' : ''}
                </ol>
            </li>
            <li><a href="#bop">BOP CST % Analysis</a>
                <ol style="list-style-type: lower-alpha; padding-left: 1rem;">
                    <li><a href="#bop-overall">Overall BOP CST % Performance</a></li>
                    <li><a href="#bop-hire">Breakdown by Hire Type</a></li>
                    <li><a href="#bop-role">Breakdown by Expert Role</a></li>
                    <li><a href="#bop-pl">Breakdown by Proficiency Level</a></li>
                </ol>
            </li>
            <li><a href="#conclusions">Conclusions &amp; Key Takeaways</a></li>
            <li><a href="#appendix-mix">Appendix: Mix-Adjusted Metrics</a>
                <ol style="list-style-type: lower-alpha; padding-left: 1rem;">
                    <li><a href="#a1-fs-mix">FS Mix-Adjusted Performance</a></li>
                    <li><a href="#a2-ttla-mix">TTLA Mix-Adjusted Performance</a></li>
                </ol>
            </li>
        </ol>
    </div>

`;

// ═══════════════════════════════════════════
// 1. EXECUTIVE SUMMARY — FS KPIs first
// ═══════════════════════════════════════════
html += buildExecutiveSummaryBlock('exec', '1');

// ═══════════════════════════════════════════
// 2. FS ANALYSIS (now section 2)
// ═══════════════════════════════════════════
html += `<hr class="section-divider">
<h2 id="fs">2. FS (TTL Full Service Consumer) Analysis</h2>
<p>FS metrics: <strong>tNPS</strong> (customer satisfaction — higher is better), <strong>IR</strong> (Issue Resolution — higher is better), <strong>SQS</strong> (Service Quality Score — higher is better), <strong>HC</strong> (Handled Conversion — higher is better), <strong>CST</strong> (Customer Service Time — lower is more efficient).</p>\n`;

// Volume distribution — FS uses cst_denominator (completed engagements)
const fsVol = renderVolumeSection('fs', '2a. FS Volume Distribution', 'Engagements', fsOverall, 'cst_den');
html += fsVol.html;
chartJS += buildVolumeCharts(fsVol);

html += renderSkuMixSection('fs', '2b. FS SKU Mix Analysis — Partners vs Intuit', fsOverall);
chartJS += buildSkuMixCharts('fs', fsOverall);

// 2c. Overall (with engagement counts + Vol %)
html += renderOverallTable('fs-overall', '2c. Overall FS Performance', fsOverall, FS_METRICS, 'cst_den', 'Engagements');
html += renderKPIs(fsOverall, FS_METRICS);

html += `<div class="chart-row">
    <div class="chart-box"><h3 style="margin-top:0;">FS tNPS — by Group</h3><canvas id="fs_tnps" height="280"></canvas></div>
    <div class="chart-box"><h3 style="margin-top:0;">FS HC — by Group</h3><canvas id="fs_hc" height="280"></canvas></div>
</div>
<div class="chart-row">
    <div class="chart-box"><h3 style="margin-top:0;">FS CST — by Group</h3><canvas id="fs_cst" height="280"></canvas></div>
    <div class="chart-box"><h3 style="margin-top:0;">FS SQS — by Group</h3><canvas id="fs_sqs" height="280"></canvas></div>
</div>\n`;
chartJS += buildOverallCharts('fs', fsOverall, FS_METRICS);
html += buildCallout('FS Overall', fsOverall, FS_METRICS);

// 2d. By Reporting Period
html += `<h3 id="fs-period">2d. FS — Breakdown by Reporting Period</h3>\n`;
html += renderDimDistroTable('fs-period-vol', 'Volume Distribution by Reporting Period', fsData, 'reporting_period', 'cst_denominator', null, PERIOD_ORDER);
html += renderTenurePivot('', '', fsByPeriod, FS_METRICS);

// 2e. By Role
html += `<h3 id="fs-role">2e. FS — Breakdown by Expert Role</h3>\n`;
html += renderDimDistroTable('fs-role-vol', 'Volume Distribution by Expert Role', fsData, 'expert_role', 'cst_denominator');
html += renderBreakdownSection('fs-role-perf', '', fsByRole, FS_METRICS, 'Role');

// 2f. By PL
html += `<h3 id="fs-pl">2f. FS — Breakdown by Proficiency Level</h3>\n`;
html += renderDimDistroTable('fs-pl-vol', 'Volume Distribution by Proficiency Level', fsData, 'proficiency_level', 'cst_denominator', null, ['PL1', 'PL2', 'PL3', 'PL4', 'Other']);
html += renderBreakdownSection('', '', fsByPL, FS_METRICS, 'Proficiency Level');

// 2g. By Hire Type
html += `<h3 id="fs-hire">2g. FS — Breakdown by Hire Type</h3>\n`;
html += renderDimDistroTable('fs-hire-vol', 'Volume Distribution by Hire Type', fsData, 'hire_type', 'cst_denominator');
html += renderInlineTable('', '', fsByHire, FS_METRICS, 'Hire Type');

// 2h. By Attrition Status
html += `<h3 id="fs-attr">2h. FS — Breakdown by Attrition Status</h3>\n`;
html += `<p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;">Attrition status reflects whether an expert was active or attrited (before/during/after peak) during the reporting period. Comparing Active vs attrited cohorts helps isolate whether performance gaps are driven by workforce stability.</p>\n`;
html += renderDimDistroTable('fs-attr-vol', 'Volume Distribution by Attrition Status', fsData, 'attr_status_adj', 'cst_denominator', null, ATTR_ORDER);
html += renderBreakdownSection('', '', fsByAttr, FS_METRICS, 'Attrition Status');

if (hasTenure && fsTenure) {
    html += `<h3 id="fs-tenure">2i. FS — Breakdown by Tenure Category</h3>\n`;
    html += `<p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;">Tenure breakdowns use the interaction dataset (contact type / tenure grain), aggregated across the full season.</p>\n`;
    html += renderDimDistroTable('fs-tenure-vol', 'Survey Volume Distribution by Tenure Category', fsIx, 'expert_tenure_category', 'tnps_denominator');
    html += renderTenurePivot('', '', fsTenure, FS_TENURE_METRICS);
}

// ═══════════════════════════════════════════
// 3. TTLA ANALYSIS (now section 3)
// ═══════════════════════════════════════════
html += `<hr class="section-divider">
<h2 id="ttla">3. TTLA (TTL Assisted Consumer) Analysis</h2>
<p>TTLA metrics: <strong>tNPS</strong> (customer satisfaction — higher is better), <strong>IR</strong> (Issue Resolution — higher is better), <strong>SQS</strong> (Service Quality Score — higher is better), <strong>AHT</strong> (Average Handle Time in minutes — lower is more efficient). Contact types: Phone, Chat, and Engagement.</p>\n`;

// Volume distribution — TTLA uses aht_denominator (contacts)
const ttlaVol = renderVolumeSection('ttla', '3a. TTLA Volume Distribution', 'Contacts', ttlaOverall, 'aht_den');
html += ttlaVol.html;
chartJS += buildVolumeCharts(ttlaVol);

// 3b. Overall
html += renderOverallTable('ttla-overall', '3b. Overall TTLA Performance', ttlaOverall, TTLA_METRICS, 'aht_den', 'Contacts');
html += renderKPIs(ttlaOverall, TTLA_METRICS);

html += `<div class="chart-row">
    <div class="chart-box"><h3 style="margin-top:0;">TTLA tNPS — by Group</h3><canvas id="ttla_tnps" height="280"></canvas></div>
    <div class="chart-box"><h3 style="margin-top:0;">TTLA AHT — by Group</h3><canvas id="ttla_aht" height="280"></canvas></div>
</div>
<div class="chart-row">
    <div class="chart-box"><h3 style="margin-top:0;">TTLA IR — by Group</h3><canvas id="ttla_ir" height="280"></canvas></div>
    <div class="chart-box"><h3 style="margin-top:0;">TTLA SQS — by Group</h3><canvas id="ttla_sqs" height="280"></canvas></div>
</div>\n`;
chartJS += buildOverallCharts('ttla', ttlaOverall, TTLA_METRICS);
html += buildCallout('TTLA Overall', ttlaOverall, TTLA_METRICS);

// 3c. By Reporting Period — volume distro table + metric pivot tables
html += `<h3 id="ttla-period">3c. TTLA — Breakdown by Reporting Period</h3>\n`;
html += renderDimDistroTable('ttla-period-vol', 'Volume Distribution by Reporting Period', ttla, 'reporting_period', 'aht_denominator', TTLA_PARTNERS, PERIOD_ORDER);
html += renderTenurePivot('', '', ttlaByPeriod, TTLA_METRICS);

// 3d. By Role + volume distribution table
html += `<h3 id="ttla-role">3d. TTLA — Breakdown by Expert Role</h3>\n`;
html += renderDimDistroTable('ttla-role-vol', 'Volume Distribution by Expert Role', ttla, 'expert_role', 'aht_denominator', TTLA_PARTNERS);
html += renderBreakdownSection('', '', ttlaByRole, TTLA_METRICS, 'Role');

// 3e. By PL (PL1-4 + Other) + volume distribution table
html += `<h3 id="ttla-pl">3e. TTLA — Breakdown by Proficiency Level</h3>\n`;
html += renderDimDistroTable('ttla-pl-vol', 'Volume Distribution by Proficiency Level', ttla, 'proficiency_level', 'aht_denominator', TTLA_PARTNERS, ['PL1', 'PL2', 'PL3', 'PL4', 'Other']);
html += renderBreakdownSection('', '', ttlaByPL, TTLA_METRICS, 'Proficiency Level');

// 3f. By Contact Type (interaction dataset)
if (hasContactType && ttlaByCT) {
    html += `<p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;">Contact type breakdowns use the interaction dataset (contact type / tenure grain), aggregated across the full season.</p>\n`;
    html += renderInlineTable('ttla-ct', '3f. TTLA — Breakdown by Contact Type', ttlaByCT, TTLA_METRICS, 'Contact Type');
}

// 3g. By Hire Type
html += `<h3 id="ttla-hire">3g. TTLA — Breakdown by Hire Type</h3>\n`;
html += renderDimDistroTable('ttla-hire-vol', 'Volume Distribution by Hire Type', ttla, 'hire_type', 'aht_denominator', TTLA_PARTNERS);
html += renderInlineTable('', '', ttlaByHire, TTLA_METRICS, 'Hire Type');

// 3h. By Attrition Status
html += `<h3 id="ttla-attr">3h. TTLA — Breakdown by Attrition Status</h3>\n`;
html += renderDimDistroTable('ttla-attr-vol', 'Volume Distribution by Attrition Status', ttla, 'attr_status_adj', 'aht_denominator', TTLA_PARTNERS, ATTR_ORDER);
html += renderBreakdownSection('', '', ttlaByAttr, TTLA_METRICS, 'Attrition Status');

if (hasTenure && ttlaTenure) {
    html += `<h3 id="ttla-tenure">3i. TTLA — Breakdown by Tenure Category</h3>\n`;
    html += `<p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;">Tenure breakdowns use the interaction dataset (contact type / tenure grain), aggregated across the full season.</p>\n`;
    html += renderDimDistroTable('ttla-tenure-vol', 'Volume Distribution by Tenure Category', ttlaIx, 'expert_tenure_category', 'aht_denominator', TTLA_PARTNERS);
    html += renderTenurePivot('', '', ttlaTenure, TTLA_METRICS);
}

// ═══════════════════════════════════════════
// 4. BOP CST % ANALYSIS
// ═══════════════════════════════════════════
html += `<hr class="section-divider">
<h2 id="bop">4. BOP CST % Analysis</h2>
<p>BOP (Back Office Prep) CST % is calculated as <code>sum(bop_num) / sum(bop_denom) &times; 100</code>.</p>\n`;

html += renderBopOverallTable('bop-overall', '4a. Overall BOP CST % Performance', bopOverall);

html += renderBopBreakdownSection('bop-hire', '4b. BOP CST % — Breakdown by Hire Type', bopByHire, 'Hire Type');
html += renderBopBreakdownSection('bop-role', '4c. BOP CST % — Breakdown by Expert Role', bopByRole, 'Role');
html += renderBopBreakdownSection('bop-pl', '4d. BOP CST % — Breakdown by Proficiency Level', bopByPL, 'Proficiency Level');

// ═══════════════════════════════════════════
// 5. CONCLUSIONS — FS first
// ═══════════════════════════════════════════
html += `<hr class="section-divider">
<h2 id="conclusions">5. Conclusions &amp; Key Takeaways</h2>\n`;

html += buildConclusions('FS', fsOverall, FS_METRICS);
html += buildConclusions('TTLA', ttlaOverall, TTLA_METRICS);

html += `<div class="callout">
    <strong>Cross-Product Commentary:</strong>
    <ul style="margin-top:0.5rem;padding-left:1.25rem;">
    <li><strong>FS strength is broad-based:</strong> Partners beat Intuit on tNPS, IR, HC, and CST simultaneously — a rare pattern suggesting genuine execution advantage, not a single-metric artifact. SQS is essentially tied.</li>
    <li><strong>TTLA gap is customer-facing:</strong> Intuit's tNPS and IR advantages on TTLA point to experience quality issues on the partner side, despite partners handling a majority of contact volume (~53%).</li>
    <li><strong>Mix-adjusted FS:</strong> After reweighting to Intuit's SKU &amp; customer mix, CST gap moves from ${fmtMixGap(fsMix.cst.rawGap)} to ${fmtMixGap(fsMix.cst.adjGap)}; tNPS gap from ${fmtMixGap(fsMix.tnps.rawGap)} to ${fmtMixGap(fsMix.tnps.adjGap)}. See Appendix for full mix-adjusted tables.</li>
    <li><strong>Attrition matters:</strong> Active experts generally outperform attrited cohorts; attrition status breakdowns should be reviewed before setting partner-specific coaching priorities.</li>
    <li><strong>Survey confidence:</strong> Always check survey counts alongside tNPS — small denominators (especially for Foundever FS or attrited cohorts) can produce volatile scores.</li>
    </ul>
</div>\n`;

html += `<div class="callout teal">
    <strong>Methodology Note:</strong> All metrics are computed as weighted averages: <code>sum(numerator) / sum(denominator)</code> across all rows matching the filter criteria. Mix-adjusted metrics reweight Partners Total to Intuit's SKU and customer-type workload mix. tNPS and IR are calculated as <code>(numerator/denominator) &times; 100</code>. AHT = total handle time / total contacts (minutes). CST = total service time / total engagements. HC = handled conversions / total handled. SQS = quality score numerator / denominator &times; 100. Higher is better for tNPS, IR, SQS, and HC. Lower is better for AHT and CST.
</div>\n`;

// ═══════════════════════════════════════════
// 5. APPENDIX — Mix-Adjusted Metrics
// ═══════════════════════════════════════════
html += `<hr class="section-divider">
<h2 id="appendix-mix">Appendix: Mix-Adjusted Performance Analysis</h2>
<p>Mix-adjusted metrics answer: <em>What would Partners Total's performance look like if they handled Intuit's workload mix?</em> <strong>Intuit</strong> is the base reference; <strong>Partners Total</strong> is reweighted using Intuit's SKU distribution and New/Returning customer mix. A persistent gap after adjustment indicates a genuine execution difference rather than a composition artifact.</p>
<p style="font-size:0.9rem;color:var(--muted);margin-bottom:1.5rem;">Gap = Partners minus Intuit. Mix Effect = Mix-Adjusted Partners minus Actual Partners. Source: ${path.basename(MIX_FILE)}.</p>

<h3 id="a1-fs-mix">A1. FS — Mix-Adjusted Performance</h3>
<p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;"><strong>HC note:</strong> Actual, mix-adjusted, and Intuit HC use only records with SKU-level HC fields populated (<code>hc_basic</code>, <code>hc_deluxe</code>, <code>hc_premium</code>), with SKU-only mix adjustment — so all three columns are on the same basis.</p>
${renderMixTable(fsMix, FS_MIX_ORDER, FS_MIX_LOWER)}
${buildMixFinding(fsMix, FS_MIX_ORDER, FS_MIX_LOWER, 'FS')}

<h3 id="a2-ttla-mix">A2. TTLA — Mix-Adjusted Performance</h3>
${renderMixTable(ttlaMix, TTLA_MIX_ORDER, TTLA_MIX_LOWER)}
${buildMixFinding(ttlaMix, TTLA_MIX_ORDER, TTLA_MIX_LOWER, 'TTLA')}
`;

html += `</div>
</div>

<footer>
    <p>Domain Partners Performance Analysis &bull; Generated ${today}</p>
    <p>Data sources: ${path.basename(PERIOD_FILE)} (${fmtN(data.length)} rows, primary) &bull; ${path.basename(INTERACTION_FILE)} (${fmtN(interactionData.length)} rows, contact/tenure) &bull; ${path.basename(MIX_FILE)} (${fmtN(mixData.length)} rows, mix-adjusted) &bull; ${path.basename(BOP_FILE)} (${fmtN(bopData.length)} rows, BOP)</p>
</footer>

<script>
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
            document.querySelectorAll('.section').forEach(function(s) { s.classList.remove('active'); });
            tab.classList.add('active');
            document.getElementById('sec-' + tab.dataset.tab).classList.add('active');
        });
    });
    ${chartJS}
});
</script>

</body>
</html>`;

fs.writeFileSync('Domain_Partner_Analysis.html', html);
console.log('Generated Domain_Partner_Analysis.html');
console.log('Period dataset:', PERIOD_FILE, '—', data.length, 'rows');
console.log('Interaction dataset:', INTERACTION_FILE, '—', interactionData.length, 'rows');
console.log('Mix dataset:', MIX_FILE, '—', mixData.length, 'rows');
console.log('BOP dataset:', BOP_FILE, '—', bopData.length, 'rows');
console.log('FS mix CST raw/adj gap:', fsMix.cst.rawGap, fsMix.cst.adjGap);
console.log('TTLA rows (period):', ttla.length, '| FS rows (period):', fsData.length);
console.log('TTLA rows (interaction):', ttlaIx.length, '| FS rows (interaction):', fsIx.length);
