use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub dark_mode: bool,
    pub zoom: f32,
    /// SSH host alias (an entry in ~/.ssh/config) for the VPS to gather from.
    pub host_alias: String,
    /// Auto-refresh the board on this cadence, in seconds. 0 disables it.
    pub auto_refresh_secs: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            dark_mode: true,
            zoom: 1.0,
            host_alias: "tecnocratica_node_1".into(),
            auto_refresh_secs: 0,
        }
    }
}

impl Config {
    pub fn dir() -> Option<PathBuf> {
        dirs::config_dir().map(|p| p.join(crate::APP_NAME))
    }

    pub fn path() -> Option<PathBuf> {
        Self::dir().map(|p| p.join("config.json"))
    }

    /// The pre-rename config location. An installed copy upgraded in place keeps
    /// its settings here, and the MSI does not move it, so the first run under
    /// the new name has to go and find it.
    fn legacy_path() -> Option<PathBuf> {
        dirs::config_dir().map(|p| p.join("Lighthouse").join("config.json"))
    }

    /// Read and parse one config file, or `None` if it is absent or unreadable.
    fn read(p: &PathBuf) -> Option<Self> {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn load() -> Self {
        let Some(p) = Self::path() else { return Self::default() };

        if let Some(cfg) = Self::read(&p) {
            return cfg;
        }

        // Nothing at the new path: fall back to the old one exactly once, and
        // write it forward so the next run reads the new location and the
        // fallback never fires again.
        if let Some(old) = Self::legacy_path() {
            if let Some(cfg) = Self::read(&old) {
                cfg.save();
                return cfg;
            }
        }

        Self::default()
    }

    pub fn save(&self) {
        let Some(dir) = Self::dir() else { return };
        let _ = std::fs::create_dir_all(&dir);
        if let Some(p) = Self::path() {
            if let Ok(s) = serde_json::to_string_pretty(self) {
                let _ = std::fs::write(p, s);
            }
        }
    }
}
