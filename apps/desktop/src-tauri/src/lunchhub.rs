//! LunchHub (lunchhub.dk): enquiries from the companies' websites, read into CENTRA's inbox.
//!
//! The interface can't call other sites itself (and shouldn't have to trust their CORS setup), so it
//! asks here. Only LunchHub's app API (`/api/ext/…`) can be reached, only over HTTPS (plain HTTP is
//! allowed for a test server on this Mac), and the personal app key goes in the Authorization header.

use std::time::Duration;

fn check(base: &str, path: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    let local = base.starts_with("http://localhost") || base.starts_with("http://127.0.0.1");
    if !(base.starts_with("https://") || local) {
        return Err("LunchHub-adressen skal starte med https://".into());
    }
    if !path.starts_with("/api/ext/") || path.contains("..") {
        return Err("Ugyldig sti".into());
    }
    Ok(format!("{base}{path}"))
}

#[tauri::command]
pub async fn lunchhub_request(base: String, token: String, method: String, path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let url = check(&base, &path)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        _ => return Err("Ugyldig metode".into()),
    };
    let mut req = req.header("Authorization", format!("Bearer {}", token.trim())).header("Accept", "application/json").header("X-LH", "1");
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b.to_string());
    }
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() { "LunchHub svarer ikke (timeout)".to_string() } else if e.is_connect() { "Kunne ikke nå LunchHub. Tjek adressen og din internetforbindelse.".to_string() } else { e.to_string() }
    })?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    match status {
        200..=299 => Ok(json),
        401 | 403 => Err("LunchHub afviste app-nøglen. Lav en ny under din profil i LunchHub.".into()),
        404 => Err("LunchHub kender ikke CENTRA-forbindelsen endnu. Den skal først lægges ind i LunchHub (se vejledningen).".into()),
        429 => Err("For mange forsøg. Vent et minut.".into()),
        _ => Err(json.get("error").and_then(|e| e.as_str()).map(|s| format!("LunchHub: {s}")).unwrap_or_else(|| format!("LunchHub svarede {status}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_lunchhubs_app_api_over_https() {
        assert_eq!(check("https://lunchhub.dk/", "/api/ext/me").unwrap(), "https://lunchhub.dk/api/ext/me");
        assert!(check("http://lunchhub.dk", "/api/ext/me").is_err());
        assert!(check("http://localhost:8090", "/api/ext/inbox").is_ok());
        assert!(check("https://lunchhub.dk", "/api/login").is_err());
        assert!(check("https://lunchhub.dk", "/api/ext/../login").is_err());
    }
}
