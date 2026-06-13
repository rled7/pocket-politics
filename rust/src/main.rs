//! Pocket Politics — Rust backend (bake-off contender vs the TypeScript backend).
//!
//! A std-only HTTP server (TcpListener + a thread per connection; no web framework) that
//! implements the SAME `API_CONTRACT.md` as the TS backend, so the shared frontend can point
//! at either and the bench harness compares them apples-to-apples. The one dependency is
//! `serde_json` (idiomatic Rust JSON). Fixtures are embedded at compile time, so the binary is
//! self-contained. Profile normalization mirrors `src/profile.ts` (+ `salary.ts`).
//!
//!   cargo run --release            # serves on 0.0.0.0:8787 (override with PORT)

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

const MEMBERS_FIXTURE: &str = include_str!("../../fixtures/members.json");
const BILLS_FIXTURE: &str = include_str!("../../fixtures/bills.json");
const MEMBER_FIXTURE: &str = include_str!("../../fixtures/member.json");
const SPONSORED_FIXTURE: &str = include_str!("../../fixtures/sponsored.json");

const CC_LIST: &str = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400";
const CC_POINTER: &str = "public, max-age=30, s-maxage=30, stale-while-revalidate=300";
const CC_IMMUTABLE: &str = "public, max-age=31536000, immutable";
const CC_NOSTORE: &str = "no-store";

/// FNV-1a (32-bit) → hex. Matches the algorithm in src/http.ts (per-backend version stamp).
fn fnv1a_hex(s: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    format!("{:x}", h)
}

fn data_version() -> String {
    fnv1a_hex(&format!("{}{}{}{}", MEMBER_FIXTURE, SPONSORED_FIXTURE, MEMBERS_FIXTURE, BILLS_FIXTURE))
}

/// ISO-8601 UTC timestamp (civil-from-days, no chrono dependency).
fn now_iso() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 { y += 1; }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, m, d, h, mi, s)
}

fn members_body() -> String {
    let arr: Value = serde_json::from_str(MEMBERS_FIXTURE).unwrap_or(Value::Array(vec![]));
    let count = arr.as_array().map(|a| a.len()).unwrap_or(0);
    json!({ "members": arr, "count": count, "live": false,
            "note": "Demo data — set CONGRESS_API_KEY for all 535 members." }).to_string()
}

fn bills_body() -> String {
    let arr: Value = serde_json::from_str(BILLS_FIXTURE).unwrap_or(Value::Array(vec![]));
    let count = arr.as_array().map(|a| a.len()).unwrap_or(0);
    json!({ "bills": arr, "count": count, "live": false,
            "note": "Demo data — set CONGRESS_API_KEY for live bills." }).to_string()
}

fn chamber_of(member: &Value) -> String {
    let terms = member.get("terms");
    let arr = terms.and_then(|t| t.as_array())
        .or_else(|| terms.and_then(|t| t.get("item")).and_then(|i| i.as_array()));
    arr.and_then(|a| a.last())
        .and_then(|t| t.get("chamber")).and_then(|v| v.as_str())
        .unwrap_or("Congress").to_string()
}

/// Mirrors salary.ts.
fn salary_for(titles: &[String]) -> (u32, &'static str) {
    let joined = titles.join(" ").to_lowercase();
    if joined.contains("speaker") {
        (223_500, "Speaker of the House")
    } else if joined.contains("majority leader") || joined.contains("minority leader") || joined.contains("president pro tempore") {
        (193_400, "Chamber leadership")
    } else {
        (174_000, "Rank-and-file member")
    }
}

/// Mirrors buildProfile() in src/profile.ts (fixture mode: live=false + note).
fn build_profile() -> Value {
    let member: Value = serde_json::from_str(MEMBER_FIXTURE).unwrap();
    let sponsored: Value = serde_json::from_str(SPONSORED_FIXTURE).unwrap();

    let mut record: Vec<Value> = vec![];
    if let Some(items) = sponsored.as_array() {
        for b in items {
            let title = b.get("title").and_then(|v| v.as_str());
            let date = b.get("introducedDate").and_then(|v| v.as_str());
            let (title, date) = match (title, date) { (Some(t), Some(d)) => (t, d), _ => continue };
            let typ = b.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let num = b.get("number").and_then(|v| v.as_str()).unwrap_or("");
            let mut id_parts: Vec<String> = vec![];
            let tn: Vec<&str> = [typ, num].iter().copied().filter(|s| !s.is_empty()).collect();
            if !tn.is_empty() { id_parts.push(tn.join(" ")); }
            if let Some(c) = b.get("congress").and_then(|v| v.as_i64()) { id_parts.push(format!("({}th)", c)); }

            let mut item = Map::new();
            item.insert("id".into(), json!(id_parts.join(" ")));
            item.insert("title".into(), json!(title));
            item.insert("date".into(), json!(date));
            if let Some(p) = b.pointer("/policyArea/name").and_then(|v| v.as_str()) {
                item.insert("policyArea".into(), json!(p));
            }
            if let (Some(ad), Some(tx)) = (
                b.pointer("/latestAction/actionDate").and_then(|v| v.as_str()),
                b.pointer("/latestAction/text").and_then(|v| v.as_str()),
            ) {
                item.insert("latestAction".into(), json!(format!("{}: {}", ad, tx)));
            }
            item.insert("role".into(), json!("sponsored"));
            record.push(Value::Object(item));
        }
    }
    record.sort_by(|a, b| b["date"].as_str().unwrap_or("").cmp(a["date"].as_str().unwrap_or("")));

    let name = member.get("directOrderName").and_then(|v| v.as_str())
        .or_else(|| member.get("honorificName").and_then(|v| v.as_str()))
        .or_else(|| member.get("bioguideId").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();
    let party = member.get("partyHistory").and_then(|p| p.as_array()).and_then(|a| a.last())
        .and_then(|p| p.get("partyName")).and_then(|v| v.as_str()).unwrap_or("Unknown");
    let state = member.get("state").and_then(|v| v.as_str()).unwrap_or("Unknown");

    let titles: Vec<String> = member.get("leadership").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|l| l.get("type").and_then(|v| v.as_str()).map(String::from)).collect())
        .unwrap_or_default();
    let (amount, role) = salary_for(&titles);

    let addr = member.get("addressInformation");
    let office: Vec<String> = ["officeAddress", "city", "district", "zipCode"].iter()
        .filter_map(|k| addr.and_then(|a| a.get(*k)).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(String::from))
        .collect();
    let mut contact = Map::new();
    if !office.is_empty() { contact.insert("office".into(), json!(office.join(", "))); }
    if let Some(p) = addr.and_then(|a| a.get("phoneNumber")).and_then(|v| v.as_str()) { contact.insert("phone".into(), json!(p)); }
    if let Some(w) = member.get("officialWebsiteUrl").and_then(|v| v.as_str()) { contact.insert("website".into(), json!(w)); }
    if let Some(ph) = member.pointer("/depiction/imageUrl").and_then(|v| v.as_str()) { contact.insert("photo".into(), json!(ph)); }

    json!({
        "bioguideId": member.get("bioguideId").and_then(|v| v.as_str()).unwrap_or(""),
        "name": name, "party": party, "state": state, "chamber": chamber_of(&member),
        "salary": { "amount": amount, "role": role },
        "contact": Value::Object(contact),
        "record": record,
        "generatedAt": now_iso(),
        "sources": [
            "Congress.gov API (api.congress.gov) — public record",
            "Congressional salary: public record (CRS / 2 U.S.C. §4501)"
        ],
        "live": false,
        "note": "Demo data — set CONGRESS_API_KEY for the live record."
    })
}

fn is_bioguide(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0].is_ascii_uppercase() && b[1..].iter().all(|c| c.is_ascii_digit())
}

fn query_get<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == key).map(|(_, v)| v))
}

/// Returns (status, cache_control, body).
fn route(path: &str, query: &str) -> (&'static str, &'static str, String) {
    let segs: Vec<&str> = path.trim_matches('/').split('/').collect();
    match segs.as_slice() {
        ["healthz"] => ("200 OK", CC_NOSTORE, json!({ "ok": true }).to_string()),
        ["api", "latest"] => ("200 OK", CC_POINTER, json!({ "dataVersion": data_version() }).to_string()),
        ["api", "members"] => ("200 OK", CC_LIST, members_body()),
        ["api", "bills"] => ("200 OK", CC_LIST, bills_body()),
        ["api", "profile"] => {
            let bioguide = query_get(query, "bioguide").unwrap_or("O000172").to_uppercase();
            if !is_bioguide(&bioguide) {
                return ("400 Bad Request", CC_NOSTORE, json!({ "error": "Invalid bioguide id (expected e.g. O000172)" }).to_string());
            }
            ("200 OK", CC_LIST, build_profile().to_string())
        }
        // Immutable, version-addressed variants.
        ["api", "v", _ver, "members"] => ("200 OK", CC_IMMUTABLE, members_body()),
        ["api", "v", _ver, "bills"] => ("200 OK", CC_IMMUTABLE, bills_body()),
        ["api", "v", _ver, "profile", bioguide] => {
            if !is_bioguide(&bioguide.to_uppercase()) {
                return ("400 Bad Request", CC_NOSTORE, json!({ "error": "Invalid bioguide id (expected e.g. O000172)" }).to_string());
            }
            ("200 OK", CC_IMMUTABLE, build_profile().to_string())
        }
        _ => ("404 Not Found", CC_NOSTORE, json!({ "error": "not found" }).to_string()),
    }
}

fn handle_client(mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) { Ok(n) if n > 0 => n, _ => return };
    let req = String::from_utf8_lossy(&buf[..n]);
    let first = req.lines().next().unwrap_or("");
    let target = first.split_whitespace().nth(1).unwrap_or("/");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));

    let (status, cache, body) = route(path, query);
    let resp = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nCache-Control: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status, cache, body.len(), body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn main() {
    let port = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787u16);
    let listener = TcpListener::bind(("0.0.0.0", port)).expect("bind");
    println!("pp-server (Rust) listening on 0.0.0.0:{port}");
    for stream in listener.incoming() {
        if let Ok(s) = stream {
            thread::spawn(move || handle_client(s));
        }
    }
}
