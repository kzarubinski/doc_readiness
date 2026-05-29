const fs = require('fs');

// ── Parse CSV ──
const raw = fs.readFileSync('domain_partner_data.csv', 'utf8').replace(/\r/g, '');
const lines = raw.trim().split('\n');
const headers = lines[0].split(',');
const data = lines.slice(1).map(l => {
    const vals = l.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = vals[i]);
    return obj;
});

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

// ── Aggregation engine ──
function aggregate(rows) {
    let tnps_num = 0, tnps_den = 0;
    let ir_num = 0, ir_den = 0;
    let sqs_num = 0, sqs_den = 0;
    let hc_num = 0, hc_den = 0;
    let aht_num = 0, aht_den = 0;
    let cst_num = 0, cst_den = 0;

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
    });

    return {
        tnps: tnps_den > 0 ? (tnps_num / tnps_den) * 100 : null,
        ir: ir_den > 0 ? (ir_num / ir_den) * 100 : null,
        sqs: sqs_den > 0 ? (sqs_num / sqs_den) * 100 : null,
        hc: hc_den > 0 ? (hc_num / hc_den) * 100 : null,
        aht: aht_den > 0 ? aht_num / aht_den : null,
        cst: cst_den > 0 ? cst_num / cst_den : null,
        tnps_den, ir_den, sqs_den, hc_den, aht_den, cst_den,
    };
}

function metricVal(m, key) {
    if (m[key] === null) return 'N/A';
    return fmt(m[key], 2);
}

// ── Split data ──
const ttla = data.filter(r => r.product_name === 'TTL Assisted Consumer');
const fsData = data.filter(r => r.product_name === 'TTL Full Service Consumer');

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
    const dimValues = [...new Set(rows.map(r => r[dimField]))].filter(v => v && v !== 'N/A').sort();

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
function buildPeriodPivot(rows, partnerList) {
    const PERIOD_ORDER = ['Before Season', '26-Jan', '26-Feb', '26-Mar', '26-Apr', 'After Season'];
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

const METRIC_LABELS = { tnps: 'tNPS', ir: 'IR', sqs: 'SQS', hc: 'HC', aht: 'AHT', cst: 'CST' };
const METRIC_DIRECTION = { tnps: 'higher', ir: 'higher', sqs: 'higher', hc: 'higher', aht: 'lower', cst: 'lower' };

// ── Compute all aggregations ──
const ttlaOverall = buildOverallTable(ttla, TTLA_PARTNERS);
const fsOverall = buildOverallTable(fsData);

const ttlaByRole = buildBreakdown(ttla, 'expert_role', TTLA_PARTNERS);
const fsByRole = buildBreakdown(fsData, 'expert_role');

const ttlaByPL = buildPLBreakdown(ttla, TTLA_PARTNERS);
const fsByPL = buildPLBreakdown(fsData);

const ttlaByCT = buildInlineBreakdown(ttla, 'contact_type', TTLA_PARTNERS);
const ttlaByHire = buildInlineBreakdown(ttla, 'hire_type', TTLA_PARTNERS);
const fsByHire = buildInlineBreakdown(fsData, 'hire_type');

const ttlaTenure = buildTenurePivot(ttla, TTLA_PARTNERS);
const fsTenure = buildTenurePivot(fsData);

const fsByPeriod = buildPeriodPivot(fsData);
const ttlaByPeriod = buildPeriodPivot(ttla, TTLA_PARTNERS);

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
function renderOverallTable(id, title, tableData, metrics, volDenKey) {
    const totalVol = tableData.reduce((s, r) => s + (r.type === 'partner' || r.type === 'intuit' ? (r.agg[volDenKey] || 0) : 0), 0);
    let html = `<h3 id="${id}">${title}</h3>\n<div class="card">\n<table>\n<thead><tr><th>Group</th>`;
    if (volDenKey) html += `<th>Vol %</th>`;
    metrics.forEach(m => { html += `<th>${METRIC_LABELS[m]}</th>`; });
    html += `</tr></thead>\n<tbody>\n`;
    tableData.forEach(row => {
        html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
        if (volDenKey) {
            const vol = row.agg[volDenKey] || 0;
            const pct = totalVol > 0 ? (vol / totalVol * 100) : 0;
            const label = row.type === 'partners_total' ? '' : fmt(pct, 1) + '%';
            html += `<td>${label}</td>`;
        }
        metrics.forEach(m => { html += `<td>${metricVal(row.agg, m)}</td>`; });
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
        metrics.forEach(m => { html += `<th>${METRIC_LABELS[m]}</th>`; });
        html += `</tr></thead>\n<tbody>\n`;
        rows.forEach(row => {
            html += `<tr class="${rowClass(row.type)}"><td><strong>${row.name}</strong></td>`;
            metrics.forEach(m => { html += `<td>${metricVal(row.agg, m)}</td>`; });
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
    html += `<table>\n<thead><tr><th>${dimField === 'proficiency_level' ? 'PL' : dimField === 'expert_role' ? 'Role' : dimField === 'hire_type' ? 'Hire Type' : dimField === 'expert_tenure_category' ? 'Tenure' : 'Category'}</th><th>Overall %</th><th>Intuit %</th><th>Partners %</th>`;
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
        h += `<th>Strengths</th></tr></thead><tbody>\n`;

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
            h += `<td>${strengths.length > 0 ? strengths.map(s => `<span class="badge badge-green">${s}</span>`).join(' ') : '<span class="badge badge-yellow">Below Intuit</span>'}</td></tr>\n`;
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
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
</head>
<body>
<div class="container">

    <h1>Domain Partners Performance Analysis</h1>
    <p class="subtitle">Partner vs Intuit Expert Performance &bull; Full Service &amp; TTLA</p>
    <p class="report-date">Report generated: ${today}</p>

    <div class="toc">
        <strong>Contents</strong>
        <ol>
            <li><a href="#exec">Executive Summary</a></li>
            <li><a href="#fs">FS (TTL Full Service Consumer) Analysis</a>
                <ol style="list-style-type: lower-alpha; padding-left: 1rem;">
                    <li><a href="#fs-volume">Volume Distribution</a></li>
                    <li><a href="#fs-overall">Overall Performance</a></li>
                    <li><a href="#fs-period">Breakdown by Reporting Period</a></li>
                    <li><a href="#fs-role">Breakdown by Expert Role</a></li>
                    <li><a href="#fs-pl">Breakdown by Proficiency Level</a></li>
                    <li><a href="#fs-hire">Breakdown by Hire Type</a></li>
                    <li><a href="#fs-tenure">Breakdown by Tenure Category</a></li>
                </ol>
            </li>
            <li><a href="#ttla">TTLA (TTL Assisted Consumer) Analysis</a>
                <ol style="list-style-type: lower-alpha; padding-left: 1rem;">
                    <li><a href="#ttla-volume">Volume Distribution</a></li>
                    <li><a href="#ttla-overall">Overall Performance</a></li>
                    <li><a href="#ttla-period">Breakdown by Reporting Period</a></li>
                    <li><a href="#ttla-role">Breakdown by Expert Role</a></li>
                    <li><a href="#ttla-pl">Breakdown by Proficiency Level</a></li>
                    <li><a href="#ttla-ct">Breakdown by Contact Type</a></li>
                    <li><a href="#ttla-hire">Breakdown by Hire Type</a></li>
                    <li><a href="#ttla-tenure">Breakdown by Tenure Category</a></li>
                </ol>
            </li>
            <li><a href="#conclusions">Conclusions &amp; Key Takeaways</a></li>
        </ol>
    </div>

`;

// ═══════════════════════════════════════════
// 1. EXECUTIVE SUMMARY — FS KPIs first
// ═══════════════════════════════════════════
html += `<h2 id="exec">1. Executive Summary</h2>
<p>This analysis compares <strong>Domain Partners</strong> (${PARTNERS_NON_INTUIT.map(p => PARTNER_SHORT[p]).join(', ')}) against <strong>Intuit</strong> across two products: <strong>TTL Full Service Consumer (FS)</strong> and <strong>TTL Assisted Consumer (TTLA)</strong>. Metrics are aggregated across all reporting periods. Each metric is computed as <code>sum(numerator) / sum(denominator)</code> across all relevant rows.</p>

<p style="font-size:0.9rem;color:var(--muted);margin:0.75rem 0;">Partners analyzed: ${PARTNERS_NON_INTUIT.map(p => `<strong>${PARTNER_SHORT[p]}</strong> (${p})`).join(', ')}. Intuit rows include all Intuit-sourced experts.</p>
\n`;

html += '<div class="kpi-row">\n';
if (fsPartners && fsIntuit) {
    html += addKPI('FS tNPS', fsPartners.agg.tnps, fsIntuit.agg.tnps, 'tnps');
    html += addKPI('FS HC', fsPartners.agg.hc, fsIntuit.agg.hc, 'hc');
    html += addKPI('FS CST', fsPartners.agg.cst, fsIntuit.agg.cst, 'cst');
}
if (ttlaPartners && ttlaIntuit) {
    html += addKPI('TTLA tNPS', ttlaPartners.agg.tnps, ttlaIntuit.agg.tnps, 'tnps');
    html += addKPI('TTLA AHT', ttlaPartners.agg.aht, ttlaIntuit.agg.aht, 'aht');
    html += addKPI('TTLA IR', ttlaPartners.agg.ir, ttlaIntuit.agg.ir, 'ir');
}
html += '</div>\n';

html += buildCallout('FS Overview', fsOverall, FS_METRICS);
html += buildCallout('TTLA Overview', ttlaOverall, TTLA_METRICS);

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

// 2b. Overall (with Vol % by cst_denominator)
html += renderOverallTable('fs-overall', '2b. Overall FS Performance', fsOverall, FS_METRICS, 'cst_den');
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

// 2c. By Reporting Period (with Vol % per metric denominator)
html += renderPeriodPivot('fs-period', '2c. FS — Breakdown by Reporting Period', fsByPeriod, FS_METRICS, FS_METRIC_VOL);

// 2d. By Role + volume distribution table
html += `<h3 id="fs-role">2d. FS — Breakdown by Expert Role</h3>\n`;
html += renderDimDistroTable('fs-role-vol', 'Volume Distribution by Expert Role (cst_denominator)', fsData, 'expert_role', 'cst_denominator');
html += renderBreakdownSection('fs-role-perf', '', fsByRole, FS_METRICS, 'Role');

// 2e. By PL (PL1-4 + Other) + volume distribution table
html += `<h3 id="fs-pl">2e. FS — Breakdown by Proficiency Level</h3>\n`;
html += renderDimDistroTable('fs-pl-vol', 'Volume Distribution by Proficiency Level (cst_denominator)', fsData, 'proficiency_level', 'cst_denominator', null, ['PL1', 'PL2', 'PL3', 'PL4', 'Other']);
html += renderBreakdownSection('', '', fsByPL, FS_METRICS, 'Proficiency Level');

// 2f. By Hire Type (inline) + volume distribution table
html += `<h3 id="fs-hire">2f. FS — Breakdown by Hire Type</h3>\n`;
html += renderDimDistroTable('fs-hire-vol', 'Volume Distribution by Hire Type (cst_denominator)', fsData, 'hire_type', 'cst_denominator');
html += renderInlineTable('', '', fsByHire, FS_METRICS, 'Hire Type');

// 2g. By Tenure (pivot) + volume distribution table — exclude CST (no meaningful data in tenure breakdown)
const FS_TENURE_METRICS = FS_METRICS.filter(m => m !== 'cst');
html += `<h3 id="fs-tenure">2g. FS — Breakdown by Tenure Category</h3>\n`;
html += renderDimDistroTable('fs-tenure-vol', 'Volume Distribution by Tenure Category (cst_denominator)', fsData, 'expert_tenure_category', 'cst_denominator');
html += renderTenurePivot('', '', fsTenure, FS_TENURE_METRICS);

// ═══════════════════════════════════════════
// 3. TTLA ANALYSIS (now section 3)
// ═══════════════════════════════════════════
html += `<hr class="section-divider">
<h2 id="ttla">3. TTLA (TTL Assisted Consumer) Analysis</h2>
<p>TTLA metrics: <strong>tNPS</strong> (customer satisfaction — higher is better), <strong>IR</strong> (Issue Resolution — higher is better), <strong>SQS</strong> (Service Quality Score — higher is better), <strong>AHT</strong> (Average Handle Time in minutes — lower is more efficient). Contact types: Phone and Chat.</p>\n`;

// Volume distribution — TTLA uses aht_denominator (contacts)
const ttlaVol = renderVolumeSection('ttla', '3a. TTLA Volume Distribution', 'Contacts', ttlaOverall, 'aht_den');
html += ttlaVol.html;
chartJS += buildVolumeCharts(ttlaVol);

// 3b. Overall (with Vol % by aht_denominator)
html += renderOverallTable('ttla-overall', '3b. Overall TTLA Performance', ttlaOverall, TTLA_METRICS, 'aht_den');
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

// 3c. By Reporting Period (with Vol % per metric denominator)
html += renderPeriodPivot('ttla-period', '3c. TTLA — Breakdown by Reporting Period', ttlaByPeriod, TTLA_METRICS, TTLA_METRIC_VOL);

// 3d. By Role + volume distribution table
html += `<h3 id="ttla-role">3d. TTLA — Breakdown by Expert Role</h3>\n`;
html += renderDimDistroTable('ttla-role-vol', 'Volume Distribution by Expert Role (aht_denominator)', ttla, 'expert_role', 'aht_denominator', TTLA_PARTNERS);
html += renderBreakdownSection('', '', ttlaByRole, TTLA_METRICS, 'Role');

// 3e. By PL (PL1-4 + Other) + volume distribution table
html += `<h3 id="ttla-pl">3e. TTLA — Breakdown by Proficiency Level</h3>\n`;
html += renderDimDistroTable('ttla-pl-vol', 'Volume Distribution by Proficiency Level (aht_denominator)', ttla, 'proficiency_level', 'aht_denominator', TTLA_PARTNERS, ['PL1', 'PL2', 'PL3', 'PL4', 'Other']);
html += renderBreakdownSection('', '', ttlaByPL, TTLA_METRICS, 'Proficiency Level');

// 3f. By Contact Type (inline)
html += renderInlineTable('ttla-ct', '3f. TTLA — Breakdown by Contact Type', ttlaByCT, TTLA_METRICS, 'Contact Type');

// 3g. By Hire Type (inline) + volume distribution table
html += `<h3 id="ttla-hire">3g. TTLA — Breakdown by Hire Type</h3>\n`;
html += renderDimDistroTable('ttla-hire-vol', 'Volume Distribution by Hire Type (aht_denominator)', ttla, 'hire_type', 'aht_denominator', TTLA_PARTNERS);
html += renderInlineTable('', '', ttlaByHire, TTLA_METRICS, 'Hire Type');

// 3h. By Tenure (pivot) + volume distribution table
html += `<h3 id="ttla-tenure">3h. TTLA — Breakdown by Tenure Category</h3>\n`;
html += renderDimDistroTable('ttla-tenure-vol', 'Volume Distribution by Tenure Category (aht_denominator)', ttla, 'expert_tenure_category', 'aht_denominator', TTLA_PARTNERS);
html += renderTenurePivot('', '', ttlaTenure, TTLA_METRICS);

// ═══════════════════════════════════════════
// 4. CONCLUSIONS — FS first
// ═══════════════════════════════════════════
html += `<hr class="section-divider">
<h2 id="conclusions">4. Conclusions &amp; Key Takeaways</h2>\n`;

html += buildConclusions('FS', fsOverall, FS_METRICS);
html += buildConclusions('TTLA', ttlaOverall, TTLA_METRICS);

html += `<div class="callout teal">
    <strong>Methodology Note:</strong> All metrics computed as weighted averages: <code>sum(numerator) / sum(denominator)</code> across all rows matching the filter criteria, aggregated across all reporting periods. tNPS and IR are calculated as <code>(numerator/denominator) &times; 100</code>. AHT = total handle time / total contacts (minutes). CST = total service time / total engagements. HC = handled conversions / total handled. SQS = quality score numerator / denominator &times; 100. Higher is better for tNPS, IR, SQS, HC. Lower is better for AHT, CST.
</div>\n`;

html += `</div>

<footer>
    <p>Domain Partners Performance Analysis &bull; Generated ${today}</p>
    <p>Data source: domain_partner_data.csv &bull; ${fmtN(data.length)} rows processed</p>
</footer>

<script>
document.addEventListener('DOMContentLoaded', function() {
    ${chartJS}
});
</script>

</body>
</html>`;

fs.writeFileSync('Domain_Partner_Analysis.html', html);
console.log('Generated Domain_Partner_Analysis.html');
console.log('Total rows processed:', data.length);
console.log('TTLA rows:', ttla.length, '| FS rows:', fsData.length);
