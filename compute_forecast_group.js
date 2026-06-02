const fs = require('fs');
const raw = fs.readFileSync('domain_partner_expert_data_expanded_f.csv', 'utf-8');
const lines = raw.trim().split('\n');
const headers = lines[0].split(',');
const data = lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = vals[i]?.trim() || '');
    return obj;
});

const num = v => parseFloat(v) || 0;
const isTS = r => r.expert_role === 'Tax Specialist';
const isNonTS = r => r.expert_role === 'Tax Associate' || r.expert_role === 'Tax Expert';
const isFS = r => r.product_name === 'TTL Full Service Consumer';
const isTTLA = r => r.product_name === 'TTL Assisted Consumer';
const fmt = (v, d=2) => v === null || isNaN(v) ? 'N/A' : v.toFixed(d);
const fgLabel = v => (!v || v === 'null') ? 'STANDARD' : v;

function aggregate(rows) {
    const s = { tnps_num:0,tnps_den:0,ir_num:0,ir_den:0,sqs_num:0,sqs_den:0,
                hc_num:0,hc_den:0,aht_num:0,aht_den:0,cst_num:0,cst_den:0 };
    for (const r of rows) {
        s.tnps_num+=num(r.tnps_numerator); s.tnps_den+=num(r.tnps_denominator);
        s.ir_num+=num(r.ir_numerator); s.ir_den+=num(r.ir_denominator);
        s.sqs_num+=num(r.sqs_numerator); s.sqs_den+=num(r.sqs_denominator);
        s.hc_num+=num(r.handled_conversion_numerator); s.hc_den+=num(r.handled_conversion_denominator);
        s.aht_num+=num(r.aht_numerator); s.aht_den+=num(r.aht_denominator);
        s.cst_num+=num(r.cst_numerator); s.cst_den+=num(r.cst_denominator);
    }
    return s;
}

function metrics(s) {
    return {
        tnps: s.tnps_den>0 ? (s.tnps_num/s.tnps_den)*100 : null,
        ir: s.ir_den>0 ? (s.ir_num/s.ir_den)*100 : null,
        sqs: s.sqs_den>0 ? (s.sqs_num/s.sqs_den)*100 : null,
        hc: s.hc_den>0 ? (s.hc_num/s.hc_den)*100 : null,
        aht: s.aht_den>0 ? s.aht_num/s.aht_den : null,
        cst: s.cst_den>0 ? s.cst_num/s.cst_den : null,
    };
}

const fgValues = [...new Set(data.map(r => fgLabel(r.forecast_group_category)))].sort();

function report(product, productFilter) {
    console.log(`\n=== ${product} — Forecast Group Category ===`);
    for (const fg of fgValues) {
        const tsRows = data.filter(r => productFilter(r) && isTS(r) && fgLabel(r.forecast_group_category) === fg);
        const ntsRows = data.filter(r => productFilter(r) && isNonTS(r) && fgLabel(r.forecast_group_category) === fg);
        const tsA = aggregate(tsRows); const ntsA = aggregate(ntsRows);
        const tsM = metrics(tsA); const ntsM = metrics(ntsA);
        const tsVol = product === 'FS' ? tsA.cst_den : tsA.aht_den;
        const ntsVol = product === 'FS' ? ntsA.cst_den : ntsA.aht_den;
        if (product === 'FS') {
            console.log(`${fg} TS: vol=${tsVol} tNPS=${fmt(tsM.tnps)} IR=${fmt(tsM.ir)} SQS=${fmt(tsM.sqs)} HC=${fmt(tsM.hc)} CST=${fmt(tsM.cst)}`);
            console.log(`${fg} NTS: vol=${ntsVol} tNPS=${fmt(ntsM.tnps)} IR=${fmt(ntsM.ir)} SQS=${fmt(ntsM.sqs)} HC=${fmt(ntsM.hc)} CST=${fmt(ntsM.cst)}`);
        } else {
            console.log(`${fg} TS: vol=${tsVol} tNPS=${fmt(tsM.tnps)} IR=${fmt(tsM.ir)} SQS=${fmt(tsM.sqs)} AHT=${fmt(tsM.aht)}`);
            console.log(`${fg} NTS: vol=${ntsVol} tNPS=${fmt(ntsM.tnps)} IR=${fmt(ntsM.ir)} SQS=${fmt(ntsM.sqs)} AHT=${fmt(ntsM.aht)}`);
        }
    }
}

report('FS', isFS);
report('TTLA', isTTLA);
