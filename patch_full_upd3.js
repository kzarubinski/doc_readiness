/**
 * patch_full_upd3.js — Applies full data refresh to PathEDU_Analysis_upd.html
 * Run: node patch_full_upd3.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'PathEDU_Analysis_upd.html');

function betweenReplace(html, startMarker, endMarker, newMiddle, label) {
  const i = html.indexOf(startMarker);
  const j = html.indexOf(endMarker, i + startMarker.length);
  if (i === -1 || j === -1) {
    throw new Error(`betweenReplace failed for ${label}: markers not found`);
  }
  return html.slice(0, i + startMarker.length) + newMiddle + html.slice(j);
}

function replaceWhole(startMarker, endMarker, replacement, html, label) {
  const i = html.indexOf(startMarker);
  const j = html.indexOf(endMarker, i + startMarker.length);
  if (i === -1 || j === -1) {
    throw new Error(`replaceWhole failed for ${label}`);
  }
  return html.slice(0, i) + replacement + html.slice(j + endMarker.length);
}

/** Insert fragment immediately before the first line matching needle (idempotent). */
function insertBeforeLine(html, needleLine, fragment, guardSubstr) {
  if (html.includes(guardSubstr)) return html;
  const idx = html.indexOf(needleLine);
  if (idx === -1) throw new Error(`insertBeforeLine: missing anchor starting "${needleLine.slice(0, 50)}"`);
  return html.slice(0, idx) + fragment + '\n\n    ' + html.slice(idx);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function verifyBasicHtmlStructure(html) {
  assert((html.match(/<html/g) || []).length === 1, 'expected one <html>');
  assert((html.match(/<\/html>/g) || []).length === 1, 'expected one </html>');
  assert((html.match(/<body>/g) || []).length === 1, 'expected one <body>');
  assert((html.match(/<\/body>/g) || []).length === 1, 'expected one </body>');
  assert(html.includes('<script>') && html.includes('</script>'), 'script block missing');
  const divOpen = (html.match(/<div/g) || []).length;
  const divClose = (html.match(/<\/div>/g) || []).length;
  assert(divOpen === divClose, `div mismatch: open ${divOpen} close ${divClose}`);
}

let html = fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n');

// --- Executive Summary callouts (preserve closing </div> of PS KPI row) ---
const CALLOUTS = `
    <div class="callout success">
        <strong>Key Finding — Tax Specialists:</strong> PathEDU experts deliver higher FS tNPS (82.91 vs 64.52) and 21.09% lower CST (2.20 vs 2.79). TTLA AHT is 8.03% lower (22.22 vs 24.16 min), confirming efficiency gains. Conversion rate lags (59.73% vs 63.02%), partially explained by heavier Basic SKU mix (53.24% vs 43.37%).
    </div>
    <div class="callout teal">
        <strong>Key Finding — Product Support:</strong> PathEDU experts are 10.20% faster on AHT (17.53 vs 19.52 min) and deliver higher tNPS (48.04 vs 45.63). Education at Work is the dominant PS partner (378 of 440 experts). Wave 6 shows strongest tNPS (54.35%), while Wave 4 is weakest (39.49%).
    </div>
`;
if (!html.includes('Key Finding — Tax Specialists')) {
  html = html.replace(
    /(\s*<\/div>)(\s*\n\s*<h2 id="toc">Table of Contents<\/h2>)/,
    '$1\n' + CALLOUTS + '\n    <h2 id="toc">Table of Contents</h2>'
  );
}

// --- KPI tiles ---
html = html.replace('<div class="value">+18.33</div>', '<div class="value">+18.39</div>');
html = html.replace('82.91 vs 64.58 (higher is better)', '82.91 vs 64.52 (higher is better)');
html = html.replace('<div class="value">−3.31 pp</div>', '<div class="value">−3.29 pp</div>');
html = html.replace('59.73% vs 63.04%', '59.73% vs 63.02%');
html = html.replace(
  '<div class="value">−2.00</div>\n            <div class="detail">17.53 vs 19.53 min</div>',
  '<div class="value">−1.99</div>\n            <div class="detail">17.53 vs 19.52 min</div>'
);
html = html.replace('<div class="detail">48.04 vs 45.58</div>', '<div class="detail">48.04 vs 45.63</div>');
// Align KPI delta with 2a difference row and conclusions (48.04 − 45.63 = +2.41)
html = html.replace(
  /<div class="label">PS tNPS<\/div>\s*\n\s*<div class="value">\+2\.46<\/div>/,
  '<div class="label">PS tNPS</div>\n            <div class="value">+2.41</div>'
);
html = html.replace('vs 10,496 NonPathEDU', 'vs 10,500 NonPathEDU');

// --- TOC ---
if (!html.includes('3h. Survey Response Analysis')) {
  html = html.replace(
    /(<li><a href="#s3g">3g\. Working Location<\/a><\/li>)/,
    '$1\n                    <li><a href="#s3h">3h. Survey Response Analysis</a></li>'
  );
}
if (!html.includes('4h. Survey Response Analysis')) {
  html = html.replace(
    /(<li><a href="#s4g">4g\. Working Location<\/a><\/li>)/,
    '$1\n                    <li><a href="#s4h">4h. Survey Response Analysis</a></li>'
  );
}

// --- 1a ---
html = betweenReplace(
  html,
  '<h3 id="s1a">1a. Overall comparison</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Group</th><th>Experts</th><th>FS Engagements</th><th>FS CST</th><th>FS tNPS</th><th>Conv Rate</th><th>TTLA AHT</th><th>TTLA tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n\n    <div class="card">\n        <h3 style="margin-top:0;">New hire vs re-hire</h3>',
  `
                <tr>
                    <td><strong>NonPathEDU Overall</strong></td><td>2,915</td><td>83,287</td>
                    <td>2.79</td><td>64.52</td><td>63.02%</td><td>24.16</td><td>73.30</td>
                </tr>
                <tr class="pathedu-row">
                    <td><strong>PathEDU Overall</strong></td><td>294</td><td>3,991</td>
                    <td>2.20</td><td>82.91</td><td>59.73%</td><td>22.22</td><td>65.38</td>
                </tr>
                <tr style="font-weight:700;background:#f1f5f9;">
                    <td>Difference (PathEDU − NonPathEDU)</td><td></td><td></td>
                    <td class="better">−0.59</td><td class="better">+18.39</td><td class="worse">−3.29 pp</td>
                    <td class="better">−1.94</td><td class="worse">−7.92</td>
                </tr>
`,
  's1a'
);

html = betweenReplace(
  html,
  '<h3 style="margin-top:0;">New hire vs re-hire</h3>\n        <table>\n            <thead>\n                <tr><th>Group</th><th>Hire type</th><th>Experts</th><th>FS CST</th><th>FS tNPS</th><th>TTLA AHT</th><th>TTLA tNPS</th><th>Conv Rate</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n\n    <div class="callout warn">',
  `
                <tr><td><strong>NonPathEDU</strong></td><td>New Hire</td><td>2,097</td><td>2.90</td><td>53.44</td><td>25.39</td><td>69.88</td><td>61.73%</td></tr>
                <tr><td><strong>NonPathEDU</strong></td><td>Re-Hire</td><td>818</td><td>2.71</td><td>73.37</td><td>22.36</td><td>77.91</td><td>63.44%</td></tr>
                <tr class="pathedu-row"><td><strong>PathEDU</strong></td><td>New Hire</td><td>275</td><td>2.21</td><td>82.13</td><td>22.20</td><td>65.35</td><td>59.93%</td></tr>
                <tr class="pathedu-row"><td><strong>PathEDU</strong></td><td>Re-Hire</td><td>19</td><td>2.18</td><td>90.48</td><td>22.51</td><td>65.70</td><td>57.45%</td></tr>
`,
  's1 nh rh'
);

// --- 1b ---
html = betweenReplace(
  html,
  '<h3 style="margin-top:0;">SKU mix — engagements and share</h3>\n        <table>\n            <thead>\n                <tr><th>Group</th><th>Basic</th><th>Deluxe</th><th>Premium</th><th>Other</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n\n    <div class="card">\n        <h3 style="margin-top:0;">Per-SKU FS mix %</h3>',
  `
                <tr>
                    <td><strong>NonPathEDU</strong></td>
                    <td>43.37% (36,122)</td><td>34.27% (28,542)</td><td>21.95% (18,282)</td><td>0.41% (341)</td>
                </tr>
                <tr class="pathedu-row">
                    <td><strong>PathEDU</strong></td>
                    <td>53.24% (2,125)</td><td>35.43% (1,414)</td><td>10.42% (416)</td><td>0.90% (36)</td>
                </tr>
`,
  'sku mix'
);

html = betweenReplace(
  html,
  '<h3 style="margin-top:0;">Per-SKU FS mix %</h3>\n        <table>\n            <thead>\n                <tr><th>Group</th><th>Basic</th><th>Deluxe</th><th>Premium</th><th>Other</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n\n    <div class="card">\n        <h3 style="margin-top:0;">Per-SKU FS CST</h3>',
  `
                <tr>
                    <td><strong>NonPathEDU</strong></td>
                    <td>43.37%</td><td>34.27%</td><td>21.95%</td><td>0.41%</td>
                </tr>
                <tr class="pathedu-row">
                    <td><strong>PathEDU</strong></td>
                    <td>53.24%</td><td>35.43%</td><td>10.42%</td><td>0.90%</td>
                </tr>
                <tr style="font-weight:700;background:#f1f5f9;">
                    <td>Difference (Path − Non)</td>
                    <td class="worse">+9.87 pp</td><td>+1.16 pp</td><td class="better">−11.53 pp</td><td>+0.49 pp</td>
                </tr>
`,
  'mix pct'
);

html = betweenReplace(
  html,
  '<h3 style="margin-top:0;">Per-SKU FS CST</h3>\n        <table>\n            <thead>\n                <tr><th>Group</th><th>Basic</th><th>Deluxe</th><th>Premium</th><th>Other</th><th>Overall FS CST</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n        <div style="font-size:0.82rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:0.5rem 0.75rem;margin-top:0.5rem;">',
  `
                <tr>
                    <td><strong>NonPathEDU</strong></td>
                    <td>2.04</td><td>2.84</td><td>4.14</td><td>5.10</td><td>2.79</td>
                </tr>
                <tr class="pathedu-row">
                    <td><strong>PathEDU</strong></td>
                    <td>1.84</td><td>2.46</td><td>3.10</td><td>3.54</td><td>2.20</td>
                </tr>
                <tr style="font-weight:700;background:#f1f5f9;">
                    <td>Difference (Path − Non)</td>
                    <td class="better">−0.20</td><td class="better">−0.38</td><td class="better">−1.04</td><td class="better">−1.56</td><td class="better">−0.59</td>
                </tr>
                <tr style="font-weight:700;background:#fffbeb;border-top:2px solid #f59e0b;">
                    <td>Mix-adjusted CST*</td>
                    <td colspan="4" style="text-align:center;font-style:italic;color:var(--muted);">PathEDU per-SKU CST × NonPathEDU mix weights</td>
                    <td class="better" style="font-size:1.05em;">2.34</td>
                </tr>
`,
  'per sku cst'
);

html = html.replace(/2\.33 remains below NonPathEDU overall CST/, '2.34 remains below NonPathEDU overall CST');
html = html.replace(/mix-adjusted CST \(2\.33\)/gi, 'mix-adjusted CST (2.34)');
html = html.replace(/43\.35%/g, '43.37%');

html = betweenReplace(
  html,
  '<h3 id="s1c">1c. Partner breakdown (PathEDU)</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Partner</th><th>Experts</th><th>FS CST</th><th>FS tNPS</th><th>TTLA AHT</th><th>TTLA tNPS</th><th>Conv Rate</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n        <div style="font-size:0.82rem;color:var(--muted);margin-top:0.5rem;">',
  `
                <tr><td><strong>Education at Work</strong></td><td>269</td><td>2.28</td><td>83.56</td><td>22.23</td><td>65.38</td><td>59.92%</td></tr>
                <tr><td><strong>Foundever</strong></td><td>25</td><td>1.71</td><td>78.65</td><td>5.05</td><td>—</td><td>57.88%</td></tr>
`,
  's1c'
);

// --- 1d full table ---
const S1D_TABLE = `<h3 id="s1d">1d. Training wave breakdown (PathEDU)</h3>
    <div class="card">
        <table>
            <thead>
                <tr><th>Wave</th><th>Experts</th><th>FS CST</th><th>FS tNPS</th><th>TTLA AHT</th><th>TTLA tNPS</th><th>Conv Rate</th></tr>
            </thead>
            <tbody>
                <tr><td>Wave 3</td><td>46</td><td>2.07</td><td>83.96</td><td>21.78</td><td>66.73</td><td>62.48%</td></tr>
                <tr><td>Wave 4</td><td>115</td><td>2.37</td><td>83.23</td><td>22.39</td><td>66.86</td><td>58.55%</td></tr>
                <tr><td>Wave 5</td><td>90</td><td>2.28</td><td>80.90</td><td>22.17</td><td>61.10</td><td>62.17%</td></tr>
                <tr><td>Wave 6</td><td>12</td><td>1.71</td><td>71.19</td><td>5.05</td><td>N/A</td><td>58.74%</td></tr>
                <tr><td>Wave 7</td><td>12</td><td>1.57</td><td>90.91</td><td>N/A</td><td>N/A</td><td>53.13%</td></tr>
                <tr><td>Re-Hire</td><td>19</td><td>2.18</td><td>90.48</td><td>22.51</td><td>65.70</td><td>57.45%</td></tr>
            </tbody>
        </table>
    </div>`;

html = replaceWhole(
  '<h3 id="s1d">1d. Training wave breakdown (PathEDU)</h3>\n    <div class="card">\n        <table>',
  '</table>\n    </div>\n    <div class="callout">',
  S1D_TABLE + '\n    <div class="callout">',
  html,
  's1d'
);

// --- 2a ---
html = betweenReplace(
  html,
  '<h3 id="s2a">2a. Overall comparison</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Group</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n\n    <div class="card">\n        <h3 style="margin-top:0;">New hire vs re-hire</h3>',
  `
                <tr><td><strong>NonPathEDU Overall</strong></td><td>10,500</td><td>19.52</td><td>45.63</td></tr>
                <tr class="pathedu-row"><td><strong>PathEDU Overall</strong></td><td>440</td><td>17.53</td><td>48.04</td></tr>
                <tr style="font-weight:700;background:#f1f5f9;">
                    <td>Difference (PathEDU − NonPathEDU)</td><td></td><td class="better">−1.99</td><td class="better">+2.41</td>
                </tr>
`,
  's2a'
);

html = betweenReplace(
  html,
  '<h3 style="margin-top:0;">New hire vs re-hire</h3>\n        <table>\n            <thead>\n                <tr><th>Group</th><th>Hire type</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n\n    <div class="callout success">',
  `
                <tr><td><strong>NonPathEDU</strong></td><td>New Hire</td><td>7,740</td><td>19.59</td><td>41.96</td></tr>
                <tr><td><strong>NonPathEDU</strong></td><td>Re-Hire</td><td>2,760</td><td>19.43</td><td>50.70</td></tr>
                <tr class="pathedu-row"><td><strong>PathEDU</strong></td><td>New Hire</td><td>361</td><td>17.72</td><td>47.53</td></tr>
                <tr class="pathedu-row"><td><strong>PathEDU</strong></td><td>Re-Hire</td><td>79</td><td>16.92</td><td>49.76</td></tr>
`,
  's2a nh'
);

html = html.replace(
  're-hire tNPS is within about one point of NonPathEDU (49.76 vs 50.65).',
  're-hire tNPS is within about one point of NonPathEDU (49.76 vs 50.70).'
);

html = betweenReplace(
  html,
  '<h3 style="margin-top:0;">NonPathEDU partners</h3>\n        <table>\n            <thead>\n                <tr><th>Partner</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="card">\n        <h3 style="margin-top:0;">PathEDU partners</h3>',
  `
                <tr><td>Concentrix</td><td>2,103</td><td>18.64</td><td>41.17</td></tr>
                <tr><td>Working Solutions</td><td>2,408</td><td>20.01</td><td>42.22</td></tr>
                <tr><td>Foundever</td><td>2,317</td><td>17.37</td><td>42.54</td></tr>
                <tr><td>Teleperformance</td><td>2,194</td><td>18.26</td><td>47.81</td></tr>
                <tr><td>LiveOps</td><td>1,478</td><td>22.20</td><td>52.72</td></tr>
`,
  's2b non'
);

html = betweenReplace(
  html,
  '<h3 id="s2c">2c. Training wave breakdown (PathEDU)</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Wave</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>Wave 5</td><td>84</td><td>17.92</td><td>46.90</td></tr>
                <tr><td>Re-Hire</td><td>79</td><td>16.92</td><td>49.76</td></tr>
                <tr><td>Wave 1</td><td>75</td><td>17.60</td><td>49.72</td></tr>
                <tr><td>Wave 6</td><td>71</td><td>17.16</td><td>54.35</td></tr>
                <tr><td>Wave 2</td><td>49</td><td>16.88</td><td>43.59</td></tr>
                <tr><td>Wave 4</td><td>44</td><td>18.33</td><td>39.49</td></tr>
                <tr><td>Wave 7</td><td>38</td><td>20.87</td><td>51.08</td></tr>
`,
  's2c'
);

html = html.replace(
  'NonPathEDU partner AHT spans a wide band (17.35–22.20 min);',
  'NonPathEDU partner AHT spans a wide band (17.37–22.20 min);'
);

// --- 3a ---
html = betweenReplace(
  html,
  '<h3 id="s3a">3a. Partner</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Partner</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>Education at Work</td><td>269</td><td>2.28</td><td>83.56</td><td>59.99%</td><td>22.23</td></tr>
                <tr><td>Foundever</td><td>25</td><td>1.71</td><td>78.65</td><td>57.97%</td><td>5.05</td></tr>
`,
  's3a'
);

html = html.replace(
  /<div class="callout">EAW defines the program’s scale; Foundever shows the lowest CST but with TTLA AHT driven by almost no TTLA handle volume\.<\/div>/,
  '<div class="callout"><strong>Key:</strong> EAW dominates with 91.5% of experts and higher tNPS.</div>'
);

// --- 3b University ---
html = betweenReplace(
  html,
  '<h3 id="s3b">3b. University</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>University</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout warn">',
  `
                <tr><td>Arizona State University</td><td>81</td><td>2.21</td><td>81.94</td><td>59.14%</td><td>22.42</td></tr>
                <tr><td>University Of Texas - El Paso</td><td>71</td><td>2.47</td><td>84.17</td><td>59.71%</td><td>22.74</td></tr>
                <tr><td>University of Utah</td><td>40</td><td>2.02</td><td>84.93</td><td>56.74%</td><td>20.39</td></tr>
                <tr><td>El Paso Community College</td><td>20</td><td>2.03</td><td>86.36</td><td>65.59%</td><td>22.91</td></tr>
                <tr><td>Marshall</td><td>20</td><td>1.71</td><td>78.65</td><td>57.97%</td><td>5.05</td></tr>
                <tr><td>Utah Valley University</td><td>10</td><td>2.06</td><td>100.00</td><td>73.17%</td><td>24.20</td></tr>
                <tr><td>University Of Arizona</td><td>8</td><td>2.62</td><td>57.14</td><td>71.82%</td><td>22.75</td></tr>
                <tr><td>Brigham Young University</td><td>6</td><td>2.83</td><td>100.00</td><td>62.60%</td><td>24.18</td></tr>
                <tr><td>Salt Lake Community College</td><td>5</td><td>3.11</td><td>100.00</td><td>58.70%</td><td>22.37</td></tr>
                <tr><td>Northern Kentucky University</td><td>4</td><td>3.08</td><td>33.33</td><td>58.82%</td><td>21.41</td></tr>
                <tr><td>University of Cincinnati</td><td>2</td><td>2.14</td><td>100.00</td><td>65.91%</td><td>18.89</td></tr>
`,
  's3b'
);

html = html.replace(
  '<div class="callout warn">ASU and UTEP carry the largest PathEDU TS populations; several schools sit at very low expert counts, where CST, conversion, and tNPS can move sharply from a handful of contacts.</div>',
  '<div class="callout warn"><strong>Key:</strong> ASU provides most volume; EPCC has highest tNPS (86.36) among large schools; NKU underperforms significantly.</div>'
);

// --- 3c ---
html = betweenReplace(
  html,
  '<h3 id="s3c">3c. Attrition stage</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Stage</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>AttrAfterPeak</td><td>210</td><td>2.21</td><td>82.56</td><td>59.80%</td><td>22.21</td></tr>
                <tr><td>AttrBeforePeak</td><td>78</td><td>1.97</td><td>92.00</td><td>60.02%</td><td>22.84</td></tr>
                <tr><td>AttrDuringTraining</td><td>6</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td></tr>
`,
  's3c'
);

// --- 3d ---
html = betweenReplace(
  html,
  '<h3 id="s3d">3d. Training wave</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Wave</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>Wave 4</td><td>115</td><td>2.38</td><td>83.23</td><td>58.63%</td><td>22.39</td></tr>
                <tr><td>Wave 5</td><td>90</td><td>2.28</td><td>80.90</td><td>62.21%</td><td>22.17</td></tr>
                <tr><td>Wave 3</td><td>46</td><td>2.07</td><td>83.96</td><td>62.54%</td><td>21.78</td></tr>
                <tr><td>Re-Hire</td><td>19</td><td>2.18</td><td>90.48</td><td>57.45%</td><td>22.51</td></tr>
                <tr><td>Wave 6</td><td>12</td><td>1.71</td><td>71.19</td><td>58.88%</td><td>5.05</td></tr>
                <tr><td>Wave 7</td><td>12</td><td>1.57</td><td>90.91</td><td>53.13%</td><td>N/A</td></tr>
`,
  's3d'
);

// --- 3e ---
html = betweenReplace(
  html,
  '<h3 id="s3e">3e. Graduation year</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Year</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>Junior</td><td>102</td><td>2.19</td><td>79.45</td><td>57.28%</td><td>22.62</td></tr>
                <tr><td>Senior</td><td>59</td><td>2.22</td><td>82.05</td><td>61.00%</td><td>20.82</td></tr>
                <tr><td>Sophomore</td><td>48</td><td>2.26</td><td>83.58</td><td>60.35%</td><td>23.00</td></tr>
                <tr><td>Freshman</td><td>28</td><td>2.36</td><td>89.19</td><td>60.64%</td><td>24.06</td></tr>
                <tr><td>Graduate</td><td>11</td><td>1.81</td><td>100.00</td><td>61.64%</td><td>19.12</td></tr>
                <tr><td>Other</td><td>2</td><td>1.65</td><td>100.00</td><td>62.65%</td><td>22.44</td></tr>
`,
  's3e'
);

// --- 3f ---
html = betweenReplace(
  html,
  '<h3 id="s3f">3f. Major</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Major</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout success">',
  `
                <tr><td>Business</td><td>212</td><td>2.25</td><td>82.14</td><td>59.19%</td><td>22.17</td></tr>
                <tr><td>Non-Business</td><td>59</td><td>2.06</td><td>85.82</td><td>61.76%</td><td>22.43</td></tr>
`,
  's3f'
);

html = html.replace('Non-business majors edge out business majors on CST, tNPS, conversion, and TTLA AHT', 'Non-business majors edge out business majors on CST, tNPS, conversion, and TTLA AHT');

// --- 3g ---
html = betweenReplace(
  html,
  '<h3 id="s3g">3g. Working location</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Location</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout warn">',
  `
                <tr><td>Onsite</td><td>184</td><td>2.28</td><td>83.86</td><td>60.64%</td><td>22.19</td></tr>
                <tr><td>Virtual</td><td>54</td><td>1.98</td><td>78.83</td><td>56.47%</td><td>22.25</td></tr>
`,
  's3g'
);

// --- 3h NEW ---
const S3H = `
    <h3 id="s3h">3h. Survey Response Analysis</h3>
    <div class="card">
        <h4 style="margin:0 0 0.5rem;color:var(--muted);font-size:0.9rem;">Q1 — Why did you join PathEDU?</h4>
        <table>
            <thead>
                <tr><th>Response</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv %</th><th>TTLA AHT</th></tr>
            </thead>
            <tbody>
                <tr><td>Build my resume/skills</td><td>21</td><td>2.41</td><td>85.86</td><td>57.66</td><td>21.90</td></tr>
                <tr><td>Earn income while in school</td><td>13</td><td>2.08</td><td>86.11</td><td>56.69</td><td>21.48</td></tr>
                <tr><td>Flexible work that fits my schedule</td><td>16</td><td>1.74</td><td>83.05</td><td>66.17</td><td>20.91</td></tr>
                <tr><td>Gain experience relevant to my future career</td><td>56</td><td>2.25</td><td>86.99</td><td>59.49</td><td>22.26</td></tr>
            </tbody>
        </table>
        <p style="font-size:0.88rem;margin-top:0.5rem;"><strong>Key:</strong> Flexible-schedule seekers have lowest CST and highest conversion; career-experience seekers have highest tNPS.</p>
    </div>
    <div class="card">
        <h4 style="margin:0 0 0.5rem;color:var(--muted);font-size:0.9rem;">Q2 — How do you view this role?</h4>
        <table>
            <thead>
                <tr><th>Response</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv %</th><th>TTLA AHT</th></tr>
            </thead>
            <tbody>
                <tr><td>A mix of income and career building</td><td>56</td><td>2.01</td><td>87.57</td><td>61.60</td><td>21.87</td></tr>
                <tr><td>Mostly a career-building opportunity</td><td>39</td><td>2.39</td><td>81.74</td><td>57.29</td><td>22.02</td></tr>
                <tr><td>Mostly a job to earn money</td><td>11</td><td>2.10</td><td>90.00</td><td>62.73</td><td>20.89</td></tr>
            </tbody>
        </table>
        <p style="font-size:0.88rem;margin-top:0.5rem;"><strong>Key:</strong> &quot;Mix&quot; group has best CST/conversion balance; &quot;career-only&quot; shows lowest tNPS.</p>
    </div>
    <div class="card">
        <h4 style="margin:0 0 0.5rem;color:var(--muted);font-size:0.9rem;">Q3 — How relevant is this to your career?</h4>
        <table>
            <thead>
                <tr><th>Response</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv %</th><th>TTLA AHT</th></tr>
            </thead>
            <tbody>
                <tr><td>Not relevant</td><td>7</td><td>1.99</td><td>87.50</td><td>57.25</td><td>22.63</td></tr>
                <tr><td>Somewhat relevant</td><td>35</td><td>2.20</td><td>88.65</td><td>61.71</td><td>21.26</td></tr>
                <tr><td>Very relevant</td><td>64</td><td>2.13</td><td>83.61</td><td>59.77</td><td>22.02</td></tr>
            </tbody>
        </table>
        <p style="font-size:0.88rem;margin-top:0.5rem;"><strong>Key:</strong> &quot;Somewhat relevant&quot; leads on conversion and tNPS; &quot;Very relevant&quot; underperforms expectations.</p>
    </div>
`;

html = insertBeforeLine(
  html,
  '<div class="chart-row">\n        <div class="chart-box"><canvas id="c3gCST"',
  S3H.trimEnd(),
  'id="s3h"'
);

// --- 4b ---
html = betweenReplace(
  html,
  '<h3 id="s4b">4b. University</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>University</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout danger">',
  `
                <tr><td>Univ. of Texas - El Paso</td><td>114</td><td>18.20</td><td>43.35</td></tr>
                <tr><td>Arizona State University</td><td>85</td><td>17.42</td><td>56.27</td></tr>
                <tr><td>Marshall</td><td>31</td><td>19.04</td><td>52.68</td></tr>
                <tr><td>El Paso Community College</td><td>25</td><td>15.90</td><td>39.81</td></tr>
                <tr><td>University of Utah</td><td>24</td><td>16.03</td><td>55.36</td></tr>
                <tr><td>USA | Texas</td><td>18</td><td>18.15</td><td>50.24</td></tr>
                <tr><td>Northern Kentucky University</td><td>18</td><td>18.24</td><td>21.18</td></tr>
                <tr><td>USA | Arizona</td><td>17</td><td>17.62</td><td>39.24</td></tr>
                <tr><td>Utah Valley University</td><td>10</td><td>18.62</td><td>50.71</td></tr>
                <tr><td>University of Cincinnati</td><td>8</td><td>20.52</td><td>55.24</td></tr>
                <tr><td>University Of Arizona</td><td>7</td><td>17.86</td><td>50.21</td></tr>
                <tr><td>Salt Lake Community College</td><td>6</td><td>15.86</td><td>44.89</td></tr>
`,
  's4b'
);

html = html.replace(
  '<div class="callout danger">ASU leads on tNPS among high-volume schools; NKU is a low-tNPS outlier on modest volume.</div>',
  '<div class="callout danger"><strong>Key:</strong> UTEP and ASU lead volume; review low-tNPS corridors (e.g., EPCC, USA | Arizona) with modest denominators.</div>'
);

// --- 4c ---
html = betweenReplace(
  html,
  '<h3 id="s4c">4c. Attrition stage</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Stage</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout warn">',
  `
                <tr><td>AttrAfterPeak</td><td>283</td><td>17.76</td><td>49.57</td></tr>
                <tr><td>AttrBeforePeak</td><td>155</td><td>15.60</td><td>34.50</td></tr>
`,
  's4c'
);

// --- 4d ---
html = betweenReplace(
  html,
  '<h3 id="s4d">4d. Training wave</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Wave</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>Wave 5</td><td>84</td><td>17.92</td><td>46.90</td></tr>
                <tr><td>Re-Hire</td><td>79</td><td>16.92</td><td>49.76</td></tr>
                <tr><td>Wave 1</td><td>75</td><td>17.60</td><td>49.72</td></tr>
                <tr><td>Wave 6</td><td>71</td><td>17.16</td><td>54.35</td></tr>
                <tr><td>Wave 2</td><td>49</td><td>16.88</td><td>43.59</td></tr>
                <tr><td>Wave 4</td><td>44</td><td>18.33</td><td>39.49</td></tr>
                <tr><td>Wave 7</td><td>38</td><td>20.87</td><td>51.08</td></tr>
`,
  's4d'
);

// --- 4e ---
html = betweenReplace(
  html,
  '<h3 id="s4e">4e. Graduation year</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Year</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>Junior</td><td>95</td><td>17.47</td><td>52.34</td></tr>
                <tr><td>Freshman</td><td>85</td><td>17.90</td><td>48.18</td></tr>
                <tr><td>Sophomore</td><td>79</td><td>18.18</td><td>47.71</td></tr>
                <tr><td>Senior</td><td>58</td><td>17.63</td><td>45.81</td></tr>
                <tr><td>Graduate</td><td>13</td><td>16.29</td><td>41.67</td></tr>
`,
  's4e'
);

// --- 4f ---
html = betweenReplace(
  html,
  '<h3 id="s4f">4f. Major</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Major</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout">',
  `
                <tr><td>Non-Business</td><td>206</td><td>17.60</td><td>47.27</td></tr>
                <tr><td>Business</td><td>202</td><td>17.50</td><td>49.49</td></tr>
`,
  's4f'
);

html = html.replace(
  'Business and non-business majors track closely on AHT; business sits fractionally higher on tNPS in this split.',
  'Non-business leads on headcount; business sits higher on tNPS with slightly lower AHT in this split.'
);

// --- 4g ---
html = betweenReplace(
  html,
  '<h3 id="s4g">4g. Working location</h3>\n    <div class="card">\n        <table>\n            <thead>\n                <tr><th>Location</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>\n            </thead>\n            <tbody>\n',
  '\n            </tbody>\n        </table>\n    </div>\n    <div class="callout warn">',
  `
                <tr><td>Onsite</td><td>244</td><td>17.45</td><td>49.70</td></tr>
                <tr><td>Virtual</td><td>139</td><td>17.88</td><td>44.77</td></tr>
`,
  's4g'
);

html = html.replace(
  '<div class="callout warn">Onsite PathEDU PS experts combine shorter AHT with much higher tNPS than virtual peers in these aggregates.</div>',
  '<div class="callout warn">Onsite shows higher tNPS than virtual in these aggregates (estimates from weighted rollups).</div>'
);

// --- 4h ---
const S4H = `
    <h3 id="s4h">4h. Survey Response Analysis</h3>
    <div class="card">
        <h4 style="margin:0 0 0.5rem;color:var(--muted);font-size:0.9rem;">Q1 — Why did you join PathEDU?</h4>
        <table>
            <thead>
                <tr><th>Response</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>
            </thead>
            <tbody>
                <tr><td>Build my resume/skills</td><td>31</td><td>17.43</td><td>50.39</td></tr>
                <tr><td>Earn income while in school</td><td>39</td><td>16.93</td><td>50.64</td></tr>
                <tr><td>Flexible work that fits my schedule</td><td>39</td><td>17.91</td><td>50.97</td></tr>
                <tr><td>Gain experience relevant to my future career</td><td>36</td><td>18.26</td><td>47.12</td></tr>
            </tbody>
        </table>
        <p style="font-size:0.88rem;margin-top:0.5rem;"><strong>Key:</strong> &quot;Earn income&quot; has lowest AHT; &quot;Gain experience&quot; has longest AHT and lowest tNPS.</p>
    </div>
    <div class="card">
        <h4 style="margin:0 0 0.5rem;color:var(--muted);font-size:0.9rem;">Q2 — How do you view this role?</h4>
        <table>
            <thead>
                <tr><th>Response</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>
            </thead>
            <tbody>
                <tr><td>A mix of income and career building</td><td>76</td><td>18.82</td><td>52.97</td></tr>
                <tr><td>Mostly a career-building opportunity</td><td>33</td><td>16.69</td><td>44.17</td></tr>
                <tr><td>Mostly a job to earn money</td><td>36</td><td>16.26</td><td>48.99</td></tr>
            </tbody>
        </table>
        <p style="font-size:0.88rem;margin-top:0.5rem;"><strong>Key:</strong> &quot;Career-building&quot; framing shows lowest tNPS; &quot;Mix&quot; has highest tNPS despite longest AHT.</p>
    </div>
    <div class="card">
        <h4 style="margin:0 0 0.5rem;color:var(--muted);font-size:0.9rem;">Q3 — How relevant is this to your career?</h4>
        <table>
            <thead>
                <tr><th>Response</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>
            </thead>
            <tbody>
                <tr><td>Not relevant</td><td>26</td><td>17.16</td><td>52.17</td></tr>
                <tr><td>Somewhat relevant</td><td>82</td><td>17.21</td><td>51.37</td></tr>
                <tr><td>Very relevant</td><td>37</td><td>18.64</td><td>46.08</td></tr>
            </tbody>
        </table>
        <p style="font-size:0.88rem;margin-top:0.5rem;"><strong>Key:</strong> &quot;Very relevant&quot; has highest AHT and lowest tNPS — counterintuitive result.</p>
    </div>
`;

html = insertBeforeLine(
  html,
  '<div class="chart-row">\n        <div class="chart-box"><canvas id="c4gAHT"',
  S4H.trimEnd(),
  'id="s4h"'
);

// --- Section 5 ---
const S5_FINDINGS = `    <div class="card">
        <h3 style="margin-top:0;">Key Findings</h3>
        <ul style="padding-left:1.25rem; list-style-type:disc;">
            <li><strong>PathEDU experts outperform on customer satisfaction and efficiency in both roles.</strong> TS PathEDU delivers higher FS tNPS (82.91 vs 64.52, +18.39 pp), 21.15% lower CST (2.20 vs 2.79), and 8.03% lower TTLA AHT (22.22 vs 24.16 min) — advantages that hold within every SKU category. Mix-adjusted CST (re-weighted to NonPathEDU's heavier-Premium mix) is still ~16.1% lower at 2.34. PS PathEDU is 10.20% faster on AHT (17.53 vs 19.52 min) and +2.41 pts higher on tNPS (48.04 vs 45.63). These advantages persist across New Hires, Re-Hires, and the AttrAfterPeak comparison lens.</li>
            <li><strong>Conversion rate is the primary remaining TS gap.</strong> PathEDU trails NonPathEDU by 3.29 pp on conversion (59.73% vs 63.02%). PathEDU's heavier Basic SKU mix (53.24% vs 43.37%) is a likely contributing factor. Re-Hires show a wider conversion deficit (−5.99 pp vs NonPathEDU RH at 63.44%), suggesting part of the gap is structural rather than a ramp-up artifact alone.</li>
            <li><strong>Education at Work carries most PathEDU volume.</strong> EAW delivers strong TS quality (83.56 tNPS at overall partner cut; re-hires at the cohort level reach 90.48 FS tNPS) and competitive PS (AHT 17.44, tNPS 47.91). Among universities, Arizona State and UT El Paso provide the bulk of volume with solid results; Northern Kentucky University underperforms on tNPS in both roles.</li>
        </ul>
    </div>`;

const S5_RECS = `    <div class="card" style="border-left:4px solid var(--primary);">
        <h3 style="margin-top:0;">Next Year Recommendations</h3>
        <ul style="padding-left:1.25rem; list-style-type:disc;">
            <li><strong>Close the TS conversion gap with targeted coaching.</strong> Focus on conversion-specific training — particularly for Basic SKU returns where PathEDU's heavier mix concentrates. PathEDU leads on TTLA AHT (22.22 vs 24.16 min), so the conversion gap is the remaining priority among headline TS customer outcomes.</li>
            <li><strong>Investigate underperforming university pipelines.</strong> Northern Kentucky University's low tNPS in both TS (33.33) and PS (21.18) suggests a training or support gap — a targeted program review could identify root causes and improvement opportunities.</li>
            <li><strong>Reduce early attrition and stabilize newer cohorts.</strong> AttrBeforePeak experts show strong TS tNPS but represent lost investment — retention efforts during ramp-up could improve both metrics and ROI. Wave 7 PS cohorts show elevated AHT (20.87 min), likely reflecting ramp-up lag; monitor closely and provide additional support to newer waves to prevent efficiency dips from persisting.</li>
        </ul>
    </div>`;

if (!html.includes('~16.1% lower at 2.34')) {
  html = replaceWhole(
    '    <div class="card">\n        <h3 style="margin-top:0;">Key Findings</h3>',
    '\n        </ul>\n    </div>\n\n',
    S5_FINDINGS + '\n',
    html,
    's5 findings'
  );
}

if (!html.includes('among headline TS customer outcomes')) {
  html = replaceWhole(
    '    <div class="card" style="border-left:4px solid var(--primary);">\n        <h3 style="margin-top:0;">Next Year Recommendations</h3>',
    '\n        </ul>\n    </div>\n\n</div>',
    S5_RECS + '\n\n</div>',
    html,
    's5 recs'
  );
}

// --- Chart.js updates ---
html = html.replace('data: [64.58, 82.91]', 'data: [64.52, 82.91]');
html = html.replace('data: [63.04, 59.73]', 'data: [63.02, 59.73]');
html = html.replace(
  "{ label: 'Basic', data: [43.35, 53.24]",
  "{ label: 'Basic', data: [43.37, 53.24]"
);
html = html.replace(
  "{ label: 'Premium', data: [21.97, 10.42]",
  "{ label: 'Premium', data: [21.95, 10.42]"
);
html = html.replace(
  "{ label: 'NonPathEDU', data: [2.03, 2.84, 4.14, 5.10]",
  "{ label: 'NonPathEDU', data: [2.04, 2.84, 4.14, 5.10]"
);

html = html.replace(
  "data: [19.53, 19.59, 19.43]",
  "data: [19.52, 19.59, 19.43]"
);
html = html.replace(
  "data: [45.58, 41.91, 50.65]",
  "data: [45.63, 41.96, 50.70]"
);

html = html.replace('data: [17.60, 16.88, 18.33, 17.92, 17.16, 20.87, 16.92]', 'data: [17.92, 16.92, 17.60, 17.16, 16.88, 18.33, 20.87]');
html = html.replace('data: [49.72, 43.59, 39.49, 46.90, 54.35, 51.08, 49.76]', 'data: [46.90, 49.76, 49.72, 54.35, 43.59, 39.49, 51.08]');

html = html.replace('const psWaveLbl = [\'Wave 1\', \'Wave 2\', \'Wave 4\', \'Wave 5\', \'Wave 6\', \'Wave 7\', \'Re-Hire\'];', 'const psWaveLbl = [\'Wave 5\', \'Re-Hire\', \'Wave 1\', \'Wave 6\', \'Wave 2\', \'Wave 4\', \'Wave 7\'];');

html = html.replace('const psPartnerAHTData = [18.64, 20.01, 17.35, 18.26, 22.20, 17.44, 18.81];', 'const psPartnerAHTData = [18.64, 20.01, 17.37, 18.26, 22.20, 17.44, 18.81];');
html = html.replace('const psPartnertNPSData = [41.17, 42.20, 42.34, 47.76, 52.68, 47.91, 49.72];', 'const psPartnertNPSData = [41.17, 42.22, 42.54, 47.81, 52.72, 47.91, 49.72];');

// 3b charts
html = html.replace(
  "const uniLbl = ['ASU', 'UTEP', 'Utah', 'Marshall', 'EPCC', 'UVU', 'UofA', 'BYU', 'SLCC', 'NKU'];",
  "const uniLbl = ['ASU', 'UTEP', 'Utah', 'EPCC', 'Marshall', 'UVU', 'UofA', 'BYU', 'SLCC', 'NKU', 'UCinci'];"
);
html = html.replace(
  'data: { labels: uniLbl, datasets: [{ label: \'CST\', data: [2.21,2.46,2.02,1.71,2.03,2.06,2.62,2.83,3.11,3.08]',
  'data: { labels: uniLbl, datasets: [{ label: \'CST\', data: [2.21,2.47,2.02,2.03,1.71,2.06,2.62,2.83,3.11,3.08,2.14]'
);
html = html.replace(
  'data: { labels: uniLbl, datasets: [{ label: \'FS tNPS\', data: [81.94,84.17,84.93,78.65,86.36,100,57.14,100,100,33.33]',
  'data: { labels: uniLbl, datasets: [{ label: \'FS tNPS\', data: [81.94,84.17,84.93,86.36,78.65,100,57.14,100,100,33.33,100]'
);

// 3d CST detail uses 2.38 for W4
html = html.replace(
  'data: { labels: waveLbl, datasets: [{ label: \'CST\', data: [2.07,2.37,2.28,1.71,1.57,2.18]',
  'data: { labels: waveLbl, datasets: [{ label: \'CST\', data: [2.38,2.28,2.07,2.18,1.71,1.57]'
);
html = html.replace('const waveLbl = [\'W3\', \'W4\', \'W5\', \'W6\', \'W7\', \'Re-Hire\'];', 'const waveLbl = [\'W4\', \'W5\', \'W3\', \'RH\', \'W6\', \'W7\'];');
html = html.replace(
  'data: { labels: waveLbl, datasets: [{ label: \'FS tNPS\', data: [83.96,83.23,80.90,71.19,90.91,90.48]',
  'data: { labels: waveLbl, datasets: [{ label: \'FS tNPS\', data: [83.23,80.90,83.96,90.48,71.19,90.91]'
);

// 3e add Other
html = html.replace("const gradLbl = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];", "const gradLbl = ['Junior','Senior','Sophomore','Freshman','Graduate','Other'];");
html = html.replace(
  'data: { labels: gradLbl, datasets: [{ label: \'CST\', data: [2.36,2.25,2.19,2.22,1.81]',
  'data: { labels: gradLbl, datasets: [{ label: \'CST\', data: [2.19,2.22,2.26,2.36,1.81,1.65]'
);
html = html.replace(
  'data: { labels: gradLbl, datasets: [{ label: \'FS tNPS\', data: [89.19,83.58,79.45,82.05,100]',
  'data: { labels: gradLbl, datasets: [{ label: \'FS tNPS\', data: [79.45,82.05,83.58,89.19,100,100]'
);

// 3f Non-Business CST
html = html.replace(
  "data: { labels: ['Business', 'Non-Business'], datasets: [{ label: 'CST', data: [2.25, 2.05]",
  "data: { labels: ['Business', 'Non-Business'], datasets: [{ label: 'CST', data: [2.25, 2.06]"
);

// 4b university charts
html = html.replace(
  "const psUniLbl = ['ASU', 'EPCC', 'Marshall', 'UTEP', 'Utah', 'NKU', 'UVU', 'UofA', 'SLCC', 'UCinci', 'BYU'];",
  "const psUniLbl = ['UTEP','ASU','Marshall','EPCC','Utah','USA-TX','NKU','USA-AZ','UVU','UCinci','UofA','SLCC'];"
);
html = html.replace(
  'data: { labels: psUniLbl, datasets: [{ label: \'AHT\', data: [17.06,15.82,19.04,18.20,16.03,18.24,19.25,17.86,15.86,22.80,16.96]',
  'data: { labels: psUniLbl, datasets: [{ label: \'AHT\', data: [18.20,17.42,19.04,15.90,16.03,18.15,18.24,17.62,18.62,20.52,17.86,15.86]'
);
html = html.replace(
  'data: { labels: psUniLbl, datasets: [{ label: \'tNPS\', data: [55.72,38.12,52.68,43.35,54.25,21.18,46.03,50.21,44.89,52.63,51.85]',
  'data: { labels: psUniLbl, datasets: [{ label: \'tNPS\', data: [43.35,56.27,52.68,39.81,55.36,50.24,21.18,39.24,50.71,55.24,50.21,44.89]'
);

// 4d wave order
html = html.replace("const psWL = ['W1', 'W2', 'W4', 'W5', 'W6', 'W7', 'Re-Hire'];", "const psWL = ['W5','RH','W1','W6','W2','W4','W7'];");
html = html.replace(
  'data: { labels: psWL, datasets: [{ label: \'AHT\', data: [17.60,16.88,18.33,17.92,17.16,20.87,16.92]',
  'data: { labels: psWL, datasets: [{ label: \'AHT\', data: [17.92,16.92,17.60,17.16,16.88,18.33,20.87]'
);
html = html.replace(
  'data: { labels: psWL, datasets: [{ label: \'tNPS\', data: [49.72,43.59,39.49,46.90,54.35,51.08,49.76]',
  'data: { labels: psWL, datasets: [{ label: \'tNPS\', data: [46.90,49.76,49.72,54.35,43.59,39.49,51.08]'
);

// 4e
html = html.replace("const psGradLbl = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];", "const psGradLbl = ['Junior','Freshman','Sophomore','Senior','Graduate'];");
html = html.replace(
  'data: { labels: psGradLbl, datasets: [{ label: \'AHT\', data: [17.84,18.23,17.44,17.44,16.29]',
  'data: { labels: psGradLbl, datasets: [{ label: \'AHT\', data: [17.47,17.90,18.18,17.63,16.29]'
);
html = html.replace(
  'data: { labels: psGradLbl, datasets: [{ label: \'tNPS\', data: [47.70,47.21,51.39,43.47,41.67]',
  'data: { labels: psGradLbl, datasets: [{ label: \'tNPS\', data: [52.34,48.18,47.71,45.81,41.67]'
);

// 4f swap order to Non-Business first in chart to match table
html = html.replace(
  "data: { labels: ['Business', 'Non-Business'], datasets: [{ label: 'AHT', data: [17.45, 17.60]",
  "data: { labels: ['Non-Business', 'Business'], datasets: [{ label: 'AHT', data: [17.60, 17.50]"
);
html = html.replace(
  "data: { labels: ['Business', 'Non-Business'], datasets: [{ label: 'tNPS', data: [47.92, 47.27]",
  "data: { labels: ['Non-Business', 'Business'], datasets: [{ label: 'tNPS', data: [47.27, 49.49]"
);

// 4g
html = html.replace(
  "data: { labels: ['Onsite', 'Virtual'], datasets: [{ label: 'AHT', data: [17.42, 17.96]",
  "data: { labels: ['Onsite', 'Virtual'], datasets: [{ label: 'AHT', data: [17.45, 17.88]"
);
html = html.replace(
  "data: { labels: ['Onsite', 'Virtual'], datasets: [{ label: 'tNPS', data: [52.48, 39.12]",
  "data: { labels: ['Onsite', 'Virtual'], datasets: [{ label: 'tNPS', data: [49.70, 44.77]"
);

verifyBasicHtmlStructure(html);

fs.writeFileSync(TARGET, html, 'utf8');
console.log('Updated', TARGET);
console.log('Structure OK: html/body/div counts balanced.');
