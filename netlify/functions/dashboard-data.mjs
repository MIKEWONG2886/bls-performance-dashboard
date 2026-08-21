const SHEET_ID = "1CViU3lsEbURR4HifRJtEe32U4AIN5YcvPXuoofEQguQ";
const SIGN_GID = "1655519694";
const APPT_GID = "1178171002";
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const MONTH_ALIASES = { JAN: "JANUARY", FEB: "FEBRUARY", MAR: "MARCH", APR: "APRIL", JUN: "JUNE", JUL: "JULY", AUG: "AUGUST", SEP: "SEPTEMBER", SEPT: "SEPTEMBER", OCT: "OCTOBER", NOV: "NOVEMBER", DEC: "DECEMBER" };
const PRESENTERS = ["MIKE", "WINSLEY", "JACK", "SIM", "SK"];
const CUSTOMER_SERVICES = ["ZURA", "JULIA", "SHU", "KAI", "IRA", "JAYDEN"];

async function fetchMatrix(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=0&gid=${gid}`;
  const response = await fetch(url, { headers: { "user-agent": "BLS-Dashboard/1.0" } });
  if (!response.ok) throw new Error(`Sheet ${gid} returned ${response.status}`);
  const body = await response.text();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Unexpected response for sheet ${gid}`);
  const payload = JSON.parse(body.slice(start, end + 1));
  if (payload.status === "error") throw new Error(`Google Sheets query failed for ${gid}`);
  const width = payload.table?.cols?.length ?? 0;
  return (payload.table?.rows ?? []).map((row) => Array.from({ length: width }, (_, index) => {
    const cell = row.c?.[index];
    return cell == null ? "" : (cell.f ?? cell.v ?? "");
  }));
}

function outcome(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text.includes("SIGNED")) return "SIGNED";
  if (text.includes("FOLLOW")) return "FOLLOW UP";
  if (text.includes("REJECT")) return "REJECTED";
  if (text.includes("CONSIDER")) return "CONSIDER";
  if (text.includes("PTS")) return "PTS";
  return text ? "OTHER" : "NO REMARK";
}

function findMonth(row) {
  for (const cell of row ?? []) {
    const text = String(cell ?? "").trim().toUpperCase();
    const month = MONTHS.find((value) => text === value || text.startsWith(`${value} `));
    if (month) return month;
  }
  return null;
}

function parseSignTracker(matrix, extractedAt) {
  const blocks = matrix.map((row, rowIndex) => ({ rowIndex, month: findMonth(row) })).filter((block) => block.month);
  const groups = new Map();
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const januaryHeader = block.rowIndex === 0 && String(matrix[0]?.[1] ?? "").toUpperCase().startsWith("JANUARY ");
    const labelRow = januaryHeader ? block.rowIndex : block.rowIndex + 1;
    const dataStart = januaryHeader ? block.rowIndex + 1 : block.rowIndex + 3;
    const dataEnd = (blocks[blockIndex + 1]?.rowIndex ?? matrix.length) - 1;
    // Each Customer Service block uses six columns. Deriving the starts from
    // the live sheet width automatically supports newly added blocks.
    for (let start = 1; start < (matrix[0]?.length ?? 0); start += 6) {
      let customerService = String(matrix[labelRow]?.[start] ?? "").trim().toUpperCase();
      if (januaryHeader) customerService = customerService.replace(/^JANUARY\s+/, "").replace(/\s+DATE$/, "").trim();
      if (!customerService) continue;
      for (let rowIndex = dataStart; rowIndex <= dataEnd; rowIndex += 1) {
        const row = matrix[rowIndex] ?? [];
        const client = String(row[start + 1] ?? "").trim();
        const presenter = String(row[start + 2] ?? "").trim().toUpperCase();
        const source = String(row[start + 3] ?? "").trim() || null;
        const remark = String(row[start + 4] ?? "").trim();
        if (!client && !presenter && !source && !remark) continue;
        const item = { month: block.month, monthIndex: MONTHS.indexOf(block.month) + 1, customerService, presenter: presenter || null, source, outcome: outcome(remark) };
        const key = JSON.stringify(item);
        const existing = groups.get(key);
        if (existing) existing.count += 1;
        else groups.set(key, { ...item, count: 1 });
      }
    }
  }
  return {
    source: "Google Sheets / SIGN TRACKER 2026 NEW",
    extractedAt,
    months: [...new Set(blocks.map((block) => block.month))].sort((a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b)),
    presenters: PRESENTERS,
    customerServices: CUSTOMER_SERVICES,
    records: [...groups.values()],
    privacy: "aggregated",
  };
}

const numberOrNull = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

function reportMonth(value) {
  const title = String(value ?? "").trim().toUpperCase();
  if (!title.includes("MONTHLY REPORT")) return null;
  const token = title.replace(/MONTHLY REPORT.*$/, "").trim().split(/\s+/)[0];
  return MONTHS.includes(token) ? token : (MONTH_ALIASES[token] ?? null);
}

function metric(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text.includes("DOCUMENT")) return "documents";
  if (text.includes("APPOINTMENT")) return "appointments";
  if (text.includes("LEAD")) return "leads";
  return null;
}

function parseAppointmentTracker(matrix, extractedAt) {
  const blocks = matrix.map((row, rowIndex) => ({ rowIndex, month: reportMonth(row?.[0]) })).filter((block) => block.month);
  const reports = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const end = blocks[blockIndex + 1]?.rowIndex ?? matrix.length;
    const people = new Map();
    let currentName = null;
    let lastData = block.rowIndex;
    for (let rowIndex = block.rowIndex + 1; rowIndex < Math.min(end, block.rowIndex + 28); rowIndex += 1) {
      const row = matrix[rowIndex] ?? [];
      const name = String(row[10] ?? "").trim().toUpperCase();
      const type = metric(row[11]);
      const value = numberOrNull(row[12]);
      if (name && type) currentName = name;
      if (type && currentName) {
        if (!people.has(currentName)) people.set(currentName, { name: currentName, leads: null, documents: null, appointments: null });
        const person = people.get(currentName);
        if (!name && person[type] !== null) {
          currentName = null;
          continue;
        }
        person[type] = value;
        lastData = rowIndex;
      } else if (people.size && rowIndex > lastData + 4) break;
    }
    const consultants = [...people.values()];
    if (!consultants.length) continue;
    const totals = {};
    for (const key of ["leads", "documents", "appointments"]) {
      const values = consultants.map((person) => person[key]).filter((value) => value !== null);
      totals[key] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    }
    reports.push({ month: block.month, consultants, totals });
  }
  const latestByMonth = {};
  for (const report of reports) if (!latestByMonth[report.month]) latestByMonth[report.month] = report;
  return { extractedAt, sourceSheet: "APPT TRACKER (2026)", latestByMonth };
}

export { parseSignTracker, parseAppointmentTracker };

export default async () => {
  try {
    const extractedAt = new Date().toISOString().slice(0, 10);
    const [signMatrix, appointmentMatrix] = await Promise.all([fetchMatrix(SIGN_GID), fetchMatrix(APPT_GID)]);
    const data = parseSignTracker(signMatrix, extractedAt);
    const tracker = parseAppointmentTracker(appointmentMatrix, extractedAt);
    data.months = [...new Set([...data.months, ...Object.keys(tracker.latestByMonth)])].sort((a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b));
    return new Response(JSON.stringify({ data, tracker }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Dashboard refresh failed", error);
    return new Response(JSON.stringify({ error: "Live dashboard data is temporarily unavailable." }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
};
