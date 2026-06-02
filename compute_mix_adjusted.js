const fs = require('fs');

const raw = fs.readFileSync('domain_partner_expert_data_expanded.csv', 'utf-8');
const lines = raw.trim().split('\n');
const headers = lines[0].split(',');
const data = lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = vals[i]?.trim() || '');
    return obj;
});

const num = (v) => parseFloat(v) || 0;
const isTS = r => r.expert_role === 'Tax Specialist';
const isNonTS = r => r.expert_role === 'Tax Associate' || r.expert_role === 'Tax Expert';
const isFS = r => r.product_name === 'TTL Full Service Consumer';
const isTTLA = r => r.product_name === 'TTL Assisted Consumer';
const fmt = (v, d=2) => v === null ? 'N/A' : v.toFixed(d);

const custTypes = ['New', 'Returning'];
const skus = ['basic', 'deluxe', 'premium'];

function aggregate(rows) {
    const s = {
        tnps_num:0, tnps_den:0, ir_num:0, ir_den:0, sqs_num:0, sqs_den:0,
        hc_num:0, hc_den:0, aht_num:0, aht_den:0, cst_num:0, cst_den:0,
    };
    for (const r of rows) {
        s.tnps_num += num(r.tnps_numerator); s.tnps_den += num(r.tnps_denominator);
        s.ir_num += num(r.ir_numerator); s.ir_den += num(r.ir_denominator);
        s.sqs_num += num(r.sqs_numerator); s.sqs_den += num(r.sqs_denominator);
        s.hc_num += num(r.handled_conversion_numerator); s.hc_den += num(r.handled_conversion_denominator);
        s.aht_num += num(r.aht_numerator); s.aht_den += num(r.aht_denominator);
        s.cst_num += num(r.cst_numerator); s.cst_den += num(r.cst_denominator);
    }
    return s;
}

function skuAggregate(rows, sku) {
    const numField = (base) => base + '_' + sku + '_numerator';
    const denField = (base) => {
        if (base === 'cst' && sku === 'premium') return 'cst_premiun_denominator';
        return base + '_' + sku + '_denominator';
    };
    const s = { tnps_num:0, tnps_den:0, cst_num:0, cst_den:0, aht_num:0, aht_den:0 };
    for (const r of rows) {
        s.tnps_num += num(r[numField('tnps')]); s.tnps_den += num(r[denField('tnps')]);
        s.cst_num += num(r[numField('cst')]); s.cst_den += num(r[denField('cst')]);
        s.aht_num += num(r[numField('aht')]); s.aht_den += num(r[denField('aht')]);
    }
    return s;
}

// Mix-adjusted calculation for a ratio metric (numerator/denominator style)
// metricFn: given aggregated cell data, returns { value, weight_den }
function mixAdjust(productFilter, cellDefs, metricFn) {
    const tsActualNum = { total: 0, den: 0 };
    const ntsActualNum = { total: 0, den: 0 };
    const cells = [];

    for (const cellDef of cellDefs) {
        const tsRows = data.filter(r => productFilter(r) && isTS(r) && cellDef.filter(r));
        const ntsRows = data.filter(r => productFilter(r) && isNonTS(r) && cellDef.filter(r));

        const tsCell = metricFn(tsRows);
        const ntsCell = metricFn(ntsRows);

        cells.push({
            label: cellDef.label,
            ts_value: tsCell.value,
            ts_weight: tsCell.weight_den,
            nts_value: ntsCell.value,
            nts_weight: ntsCell.weight_den,
        });

        tsActualNum.total += tsCell.num; tsActualNum.den += tsCell.den;
        ntsActualNum.total += ntsCell.num; ntsActualNum.den += ntsCell.den;
    }

    const totalNtsWeight = cells.reduce((s, c) => s + c.nts_weight, 0);
    const totalTsWeight = cells.reduce((s, c) => s + c.ts_weight, 0);

    let mixAdjustedTs = 0;
    for (const c of cells) {
        const w = totalNtsWeight > 0 ? c.nts_weight / totalNtsWeight : 0;
        if (c.ts_value !== null) {
            mixAdjustedTs += c.ts_value * w;
        }
    }

    const actualTs = tsActualNum.den > 0 ? tsActualNum.total / tsActualNum.den : null;
    const actualNts = ntsActualNum.den > 0 ? ntsActualNum.total / ntsActualNum.den : null;

    return { actualTs, mixAdjustedTs, actualNts, cells };
}

// Cell definitions for SKU x CustomerType (6 cells)
function skuCustCells(skuField, numField, denField) {
    const cells = [];
    for (const ct of custTypes) {
        for (const sku of skus) {
            cells.push({
                label: `${sku} x ${ct}`,
                filter: r => r.new_returning_customer === ct,
                sku: sku,
            });
        }
    }
    return cells;
}

// Customer-type only cells (2 cells) for IR, HC
function custOnlyCells() {
    return custTypes.map(ct => ({
        label: ct,
        filter: r => r.new_returning_customer === ct,
    }));
}

// ============= FS METRICS =============

// FS tNPS — 6 cells (SKU x CustomerType)
console.log('=== FS tNPS Mix-Adjusted (SKU x CustomerType) ===');
const fsTnpsCells = [];
for (const ct of custTypes) {
    for (const sku of skus) {
        fsTnpsCells.push({
            label: `${sku} x ${ct}`,
            filter: r => r.new_returning_customer === ct,
            sku: sku,
        });
    }
}

const fsTnps = mixAdjust(isFS, fsTnpsCells, (rows, cellDef) => {
    // This won't work with the current signature, need to handle SKU
    return { value: null, weight_den: 0, num: 0, den: 0 };
});

// Let me redo this with a cleaner approach
function mixAdjustMetric(productFilter, cells, extractFn) {
    const results = [];
    let tsNumTotal = 0, tsDenTotal = 0;
    let ntsNumTotal = 0, ntsDenTotal = 0;

    for (const cell of cells) {
        const tsRows = data.filter(r => productFilter(r) && isTS(r) && cell.filterFn(r));
        const ntsRows = data.filter(r => productFilter(r) && isNonTS(r) && cell.filterFn(r));
        const tsE = extractFn(tsRows, cell);
        const ntsE = extractFn(ntsRows, cell);
        results.push({
            label: cell.label,
            ts_num: tsE.num, ts_den: tsE.den, ts_val: tsE.den > 0 ? tsE.num / tsE.den : null,
            nts_num: ntsE.num, nts_den: ntsE.den, nts_val: ntsE.den > 0 ? ntsE.num / ntsE.den : null,
        });
        tsNumTotal += tsE.num; tsDenTotal += tsE.den;
        ntsNumTotal += ntsE.num; ntsDenTotal += ntsE.den;
    }

    const totalNtsDen = results.reduce((s, c) => s + c.nts_den, 0);
    let mixAdj = 0;
    for (const c of results) {
        const w = totalNtsDen > 0 ? c.nts_den / totalNtsDen : 0;
        if (c.ts_val !== null) mixAdj += c.ts_val * w;
    }

    return {
        actualTs: tsDenTotal > 0 ? tsNumTotal / tsDenTotal : null,
        mixAdjTs: mixAdj,
        actualNts: ntsDenTotal > 0 ? ntsNumTotal / ntsDenTotal : null,
        cells: results,
    };
}

// Build 6-cell definitions for SKU x CustomerType
function buildSkuCustCells() {
    const cells = [];
    for (const ct of custTypes) {
        for (const sku of skus) {
            cells.push({ label: `${sku}x${ct}`, filterFn: r => r.new_returning_customer === ct, sku });
        }
    }
    return cells;
}

function buildCustCells() {
    return custTypes.map(ct => ({ label: ct, filterFn: r => r.new_returning_customer === ct }));
}

// FS tNPS (6 cells: SKU x CustomerType)
const fsTnpsR = mixAdjustMetric(isFS, buildSkuCustCells(), (rows, cell) => {
    const s = skuAggregate(rows, cell.sku);
    return { num: s.tnps_num, den: s.tnps_den };
});
console.log(`FS tNPS: Actual TS=${fmt(fsTnpsR.actualTs*100)} MixAdj TS=${fmt(fsTnpsR.mixAdjTs*100)} NTS=${fmt(fsTnpsR.actualNts*100)}`);
console.log(`  Raw gap=${fmt((fsTnpsR.actualTs - fsTnpsR.actualNts)*100)} Adj gap=${fmt((fsTnpsR.mixAdjTs - fsTnpsR.actualNts)*100)} Mix effect=${fmt((fsTnpsR.mixAdjTs - fsTnpsR.actualTs)*100)}`);

// FS CST (6 cells: SKU x CustomerType)
const fsCstR = mixAdjustMetric(isFS, buildSkuCustCells(), (rows, cell) => {
    const s = skuAggregate(rows, cell.sku);
    return { num: s.cst_num, den: s.cst_den };
});
console.log(`FS CST: Actual TS=${fmt(fsCstR.actualTs)} MixAdj TS=${fmt(fsCstR.mixAdjTs)} NTS=${fmt(fsCstR.actualNts)}`);
console.log(`  Raw gap=${fmt(fsCstR.actualTs - fsCstR.actualNts)} Adj gap=${fmt(fsCstR.mixAdjTs - fsCstR.actualNts)} Mix effect=${fmt(fsCstR.mixAdjTs - fsCstR.actualTs)}`);

// FS IR (2 cells: CustomerType only)
const fsIrR = mixAdjustMetric(isFS, buildCustCells(), (rows, cell) => {
    const s = aggregate(rows);
    return { num: s.ir_num, den: s.ir_den };
});
console.log(`FS IR: Actual TS=${fmt(fsIrR.actualTs*100)} MixAdj TS=${fmt(fsIrR.mixAdjTs*100)} NTS=${fmt(fsIrR.actualNts*100)}`);
console.log(`  Raw gap=${fmt((fsIrR.actualTs - fsIrR.actualNts)*100)} Adj gap=${fmt((fsIrR.mixAdjTs - fsIrR.actualNts)*100)} Mix effect=${fmt((fsIrR.mixAdjTs - fsIrR.actualTs)*100)}`);

// FS HC (2 cells: CustomerType only)
const fsHcR = mixAdjustMetric(isFS, buildCustCells(), (rows, cell) => {
    const s = aggregate(rows);
    return { num: s.hc_num, den: s.hc_den };
});
console.log(`FS HC: Actual TS=${fmt(fsHcR.actualTs*100)} MixAdj TS=${fmt(fsHcR.mixAdjTs*100)} NTS=${fmt(fsHcR.actualNts*100)}`);
console.log(`  Raw gap=${fmt((fsHcR.actualTs - fsHcR.actualNts)*100)} Adj gap=${fmt((fsHcR.mixAdjTs - fsHcR.actualNts)*100)} Mix effect=${fmt((fsHcR.mixAdjTs - fsHcR.actualTs)*100)}`);

// ============= TTLA METRICS =============

// TTLA tNPS (6 cells: SKU x CustomerType)
const ttlaTnpsR = mixAdjustMetric(isTTLA, buildSkuCustCells(), (rows, cell) => {
    const s = skuAggregate(rows, cell.sku);
    return { num: s.tnps_num, den: s.tnps_den };
});
console.log(`\nTTLA tNPS: Actual TS=${fmt(ttlaTnpsR.actualTs*100)} MixAdj TS=${fmt(ttlaTnpsR.mixAdjTs*100)} NTS=${fmt(ttlaTnpsR.actualNts*100)}`);
console.log(`  Raw gap=${fmt((ttlaTnpsR.actualTs - ttlaTnpsR.actualNts)*100)} Adj gap=${fmt((ttlaTnpsR.mixAdjTs - ttlaTnpsR.actualNts)*100)} Mix effect=${fmt((ttlaTnpsR.mixAdjTs - ttlaTnpsR.actualTs)*100)}`);

// TTLA AHT (6 cells: SKU x CustomerType)
const ttlaAhtR = mixAdjustMetric(isTTLA, buildSkuCustCells(), (rows, cell) => {
    const s = skuAggregate(rows, cell.sku);
    return { num: s.aht_num, den: s.aht_den };
});
console.log(`TTLA AHT: Actual TS=${fmt(ttlaAhtR.actualTs)} MixAdj TS=${fmt(ttlaAhtR.mixAdjTs)} NTS=${fmt(ttlaAhtR.actualNts)}`);
console.log(`  Raw gap=${fmt(ttlaAhtR.actualTs - ttlaAhtR.actualNts)} Adj gap=${fmt(ttlaAhtR.mixAdjTs - ttlaAhtR.actualNts)} Mix effect=${fmt(ttlaAhtR.mixAdjTs - ttlaAhtR.actualTs)}`);

// TTLA IR (2 cells: CustomerType only)
const ttlaIrR = mixAdjustMetric(isTTLA, buildCustCells(), (rows, cell) => {
    const s = aggregate(rows);
    return { num: s.ir_num, den: s.ir_den };
});
console.log(`TTLA IR: Actual TS=${fmt(ttlaIrR.actualTs*100)} MixAdj TS=${fmt(ttlaIrR.mixAdjTs*100)} NTS=${fmt(ttlaIrR.actualNts*100)}`);
console.log(`  Raw gap=${fmt((ttlaIrR.actualTs - ttlaIrR.actualNts)*100)} Adj gap=${fmt((ttlaIrR.mixAdjTs - ttlaIrR.actualNts)*100)} Mix effect=${fmt((ttlaIrR.mixAdjTs - ttlaIrR.actualTs)*100)}`);

// Cell detail for debugging
console.log('\n=== CELL DETAIL ===');
console.log('FS tNPS cells:');
for (const c of fsTnpsR.cells) {
    console.log(`  ${c.label}: TS=${c.ts_val !== null ? fmt(c.ts_val*100) : 'N/A'} (den=${c.ts_den}) NTS=${c.nts_val !== null ? fmt(c.nts_val*100) : 'N/A'} (den=${c.nts_den})`);
}
console.log('FS CST cells:');
for (const c of fsCstR.cells) {
    console.log(`  ${c.label}: TS=${c.ts_val !== null ? fmt(c.ts_val) : 'N/A'} (den=${c.ts_den}) NTS=${c.nts_val !== null ? fmt(c.nts_val) : 'N/A'} (den=${c.nts_den})`);
}
console.log('TTLA tNPS cells:');
for (const c of ttlaTnpsR.cells) {
    console.log(`  ${c.label}: TS=${c.ts_val !== null ? fmt(c.ts_val*100) : 'N/A'} (den=${c.ts_den}) NTS=${c.nts_val !== null ? fmt(c.nts_val*100) : 'N/A'} (den=${c.nts_den})`);
}
console.log('TTLA AHT cells:');
for (const c of ttlaAhtR.cells) {
    console.log(`  ${c.label}: TS=${c.ts_val !== null ? fmt(c.ts_val) : 'N/A'} (den=${c.ts_den}) NTS=${c.nts_val !== null ? fmt(c.nts_val) : 'N/A'} (den=${c.nts_den})`);
}
