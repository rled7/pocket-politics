/**
 * Address → congressional district, via the free **U.S. Census Bureau geocoder** (no key).
 * This is the core personalization: turn what a voter types into their actual district so we
 * can show *their* representatives.
 */
const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

export interface District { state: string; stateName: string; district: string; }

export async function geocodeDistrict(address: string): Promise<District | null> {
  const url = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;
  const data = await fetch(url).then((r) => r.json()).catch(() => null);
  const m = data?.result?.addressMatches?.[0];
  if (!m) return null;
  const state: string = m.addressComponents?.state ?? "";
  const geos = m.geographies ?? {};
  const cdKey = Object.keys(geos).find((k) => /Congressional Districts/i.test(k));
  const cd = cdKey && Array.isArray(geos[cdKey]) ? geos[cdKey][0] : null;
  const district = cd ? String(cd.BASENAME ?? "") : "";
  return { state, stateName: STATES[state] ?? state, district };
}

export const stateName = (abbr: string) => STATES[abbr] ?? abbr;
