import ExcelJS from 'exceljs';
import path from 'path';

/**
 * Generates a demo "account health assessment" workbook with multiple tabs and
 * a mix of ticked (Yes) / unticked (No) checkbox-style answers so you can try
 * the app end-to-end.
 *
 *   npm run build && node dist/scripts/makeSample.js
 */
async function main() {
  const wb = new ExcelJS.Workbook();

  const tabs: Record<string, [string, boolean][]> = {
    // Primary tab analyzed for the plan (checkbox-style answers).
    'Harness-Questionnaire': [
      ['Executive sponsor is identified and engaged', false],
      ['We have a mobilized internal champion', true],
      ['Business outcomes and success criteria are documented', false],
      ['Success KPIs are baselined with current-state metrics', false],
      ['Core workflows are adopted by the team', true],
      ['Users have completed onboarding/training', false],
      ['Latest CSAT/NPS is positive', true],
      ['No open P1/critical issues', true],
      ['Renewal date and contract terms are confirmed', false],
    ],
    Relationship: [
      ['Executive sponsor is identified and engaged', false],
      ['We have a mobilized internal champion', false],
      ['Key stakeholders and decision makers are mapped', true],
      ['A regular QBR / EBR cadence is in place', false],
      ['We are multi-threaded (3+ contacts)', false],
    ],
    'Value & ROI': [
      ['Business outcomes and success criteria are documented', false],
      ['Success KPIs are baselined with current-state metrics', false],
      ['Customer has realized at least one measurable win', false],
      ['An ROI / value story exists for the sponsor', false],
    ],
    Adoption: [
      ['Provisioned seats/licenses are actively used', true],
      ['Core workflows are adopted by the team', false],
      ['Users have completed onboarding/training', true],
      ['Product is embedded in a recurring workflow', false],
    ],
    Sentiment: [
      ['Latest CSAT/NPS is positive', false],
      ['There are no open escalations or complaints', false],
      ['Customer would act as a reference', false],
    ],
    Support: [
      ['No open P1/critical issues', true],
      ['Support SLAs are being met', true],
      ['Recurring root causes have been addressed', false],
    ],
    Commercial: [
      ['Renewal date and contract terms are confirmed', true],
      ['No billing/procurement friction', true],
      ['An expansion opportunity has been identified', false],
    ],
    // Risk flags: for these, TICKED (true) means a NEGATIVE impact.
    'Risk Flags': [
      ['Did Champion Leave the Company', true],
      ['Did Sponsor Leave the Company?', false],
      ['Is there a re-org that happened?', true],
      ['Training Gap', true],
      ['Customer Resource Constraints', false],
      ['Customer Technical Constraints', true],
      ['Vulnerability Costraints', false],
      ['Infosec Constraints', false],
    ],
  };

  for (const [tabName, rows] of Object.entries(tabs)) {
    const ws = wb.addWorksheet(tabName);
    ws.columns = [
      { header: 'Criteria', key: 'q', width: 55 },
      { header: 'Checked', key: 'a', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const [question, checked] of rows) {
      ws.addRow({ q: question, a: checked });
    }
  }

  // Chaos-Data-Questionnaire: label -> value rows. Values are left blank; the
  // app fills them at upload time from the live Harness chaos data.
  const chaos = wb.addWorksheet('Chaos-Data-Questionnaire');
  chaos.columns = [
    { header: 'Metric', key: 'q', width: 45 },
    { header: 'Value', key: 'v', width: 15 },
  ];
  chaos.getRow(1).font = { bold: true };
  for (const label of [
    'Percentage Of Teams Onboarded',
    'License Utilisation Percentage',
    'Avg Monthly Experiment Runs',
    'Total Number of Experiment Executions',
  ]) {
    chaos.addRow({ q: label, v: '' });
  }

  const outPath = path.join(process.cwd(), 'sample-account-health.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Sample workbook written to: ' + outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
