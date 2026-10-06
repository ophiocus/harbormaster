//! AdSense — the revenue lane, measured from the workstation.
//!
//! Shares the GA4 credential and its refresh (see [`crate::analytics`]); the
//! only addition is the `adsense.readonly` scope. **The Management API v2 has no
//! write surface at all**, so read-only is the API's ceiling rather than a
//! restraint chosen here.
//!
//! What this lane is actually for: on 2026-10-05 the publisher had the tag live
//! on a page and had still never served an ad, because the ad client sat in
//! `GETTING_READY` and onboarding was never finished. Earnings of zero is the
//! *symptom*; the states below are the *reason*, and a revenue panel that showed
//! only the zero would have left the reason invisible.
//!
//! Blocking by design, like the rest — call it off the UI thread.

use crate::analytics::Error;
use crate::model::{AdSense, AdSenseSite, DomainEarnings};
use serde::Deserialize;

const BASE: &str = "https://adsense.googleapis.com/v2";

/// Days of earnings history requested for the per-domain breakdown.
const WINDOW_DAYS: i64 = 28;

#[derive(Deserialize)]
struct Accounts {
    #[serde(default)]
    accounts: Vec<Account>,
}
#[derive(Deserialize)]
struct Account {
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(default)]
    state: String,
}

#[derive(Deserialize)]
struct AdClients {
    #[serde(default, rename = "adClients")]
    ad_clients: Vec<AdClient>,
}
#[derive(Deserialize)]
struct AdClient {
    #[serde(default, rename = "reportingDimensionId")]
    reporting_dimension_id: String,
    #[serde(default)]
    state: String,
}

#[derive(Deserialize)]
struct Sites {
    #[serde(default)]
    sites: Vec<Site>,
}
#[derive(Deserialize)]
struct Site {
    #[serde(default)]
    domain: String,
    #[serde(default)]
    state: String,
}

#[derive(Deserialize)]
struct Payments {
    #[serde(default)]
    payments: Vec<Payment>,
}
#[derive(Deserialize)]
struct Payment {
    #[serde(default)]
    name: String,
    #[serde(default)]
    amount: String,
}

#[derive(Deserialize)]
struct Alerts {
    #[serde(default)]
    alerts: Vec<Alert>,
}
#[derive(Deserialize)]
struct Alert {
    #[serde(default)]
    severity: String,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct Report {
    #[serde(default)]
    rows: Vec<ReportRow>,
}
#[derive(Deserialize)]
struct ReportRow {
    #[serde(default)]
    cells: Vec<Cell>,
}
#[derive(Deserialize)]
struct Cell {
    #[serde(default)]
    value: String,
}

/// Collect the whole AdSense picture for the one publisher this credential sees.
pub fn collect(client: &reqwest::blocking::Client, token: &str) -> Result<Option<AdSense>, Error> {
    let accounts: Accounts = get(client, token, &format!("{BASE}/accounts"))?;
    let Some(acct) = accounts.accounts.into_iter().next() else {
        // No account is a real answer, not a failure: this credential simply
        // does not own one.
        return Ok(None);
    };

    let clients: AdClients = get(client, token, &format!("{BASE}/{}/adclients", acct.name))?;
    let sites: Sites = get(client, token, &format!("{BASE}/{}/sites", acct.name))?;
    let payments: Payments = get(client, token, &format!("{BASE}/{}/payments", acct.name))?;
    let alerts: Alerts = get(client, token, &format!("{BASE}/{}/alerts", acct.name))?;

    let (publisher_id, client_state) = clients
        .ad_clients
        .into_iter()
        .next()
        .map(|c| (c.reporting_dimension_id, c.state))
        .unwrap_or_default();

    let unpaid = payments
        .payments
        .iter()
        .find(|p| p.name.ends_with("/unpaid"))
        .map(|p| p.amount.clone())
        .unwrap_or_else(|| "-".into());

    Ok(Some(AdSense {
        account: acct.name.clone(),
        display_name: acct.display_name,
        account_state: acct.state,
        publisher_id,
        client_state,
        unpaid,
        window_days: WINDOW_DAYS,
        sites: sites
            .sites
            .into_iter()
            .map(|s| AdSenseSite { domain: s.domain, state: s.state })
            .collect(),
        alerts: alerts
            .alerts
            .into_iter()
            .map(|a| format!("[{}] {}", a.severity, a.message))
            .collect(),
        by_domain: earnings_by_domain(client, token, &acct.name)?,
    }))
}

fn earnings_by_domain(
    client: &reqwest::blocking::Client,
    token: &str,
    account: &str,
) -> Result<Vec<DomainEarnings>, Error> {
    // Dates are built here rather than with a date crate: the API takes y/m/d
    // parts, and the only arithmetic needed is "N days back".
    let (y, m, d) = today_utc();
    let (sy, sm, sd) = days_before(y, m, d, WINDOW_DAYS - 1);
    let url = format!(
        "{BASE}/{account}/reports:generate\
         ?startDate.year={sy}&startDate.month={sm}&startDate.day={sd}\
         &endDate.year={y}&endDate.month={m}&endDate.day={d}\
         &dimensions=DOMAIN_NAME\
         &metrics=ESTIMATED_EARNINGS&metrics=PAGE_VIEWS&metrics=IMPRESSIONS&metrics=CLICKS\
         &orderBy=-ESTIMATED_EARNINGS&limit=25"
    );
    let rep: Report = get(client, token, &url)?;
    Ok(rep
        .rows
        .into_iter()
        .filter_map(|r| {
            let v: Vec<String> = r.cells.into_iter().map(|c| c.value).collect();
            if v.len() < 5 {
                return None;
            }
            Some(DomainEarnings {
                domain: v[0].clone(),
                earnings: v[1].clone(),
                page_views: v[2].parse().unwrap_or(0),
                impressions: v[3].parse().unwrap_or(0),
                clicks: v[4].parse().unwrap_or(0),
            })
        })
        .collect())
}

fn get<T: for<'de> Deserialize<'de>>(
    client: &reqwest::blocking::Client,
    token: &str,
    url: &str,
) -> Result<T, Error> {
    let resp = client
        .get(url)
        .bearer_auth(token)
        .send()
        .map_err(|e| Error::Http(e.to_string()))?;
    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err(Error::AuthExpired);
        }
        // The API being switched off on the GCP project, and the token predating
        // the adsense scope, both arrive as 403 and need different fixes.
        if text.contains("SERVICE_DISABLED") {
            return Err(Error::Http("AdSense API not enabled on the GCP project".into()));
        }
        if text.contains("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || text.contains("insufficient") {
            return Err(Error::Http("token lacks adsense.readonly - re-run mint_adc.py".into()));
        }
        return Err(Error::Http(format!("{status}")));
    }
    serde_json::from_str::<T>(&text).map_err(|e| Error::Parse(e.to_string()))
}

// ── minimal civil-date helpers ──────────────────────────────────────────────
// Only "today" and "N days earlier" are needed, so this avoids a date crate.

fn today_utc() -> (i64, i64, i64) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    civil_from_days(secs / 86_400)
}

fn days_before(y: i64, m: i64, d: i64, n: i64) -> (i64, i64, i64) {
    civil_from_days(days_from_civil(y, m, d) - n)
}

/// Howard Hinnant's civil-calendar algorithms, days since 1970-01-01.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}
