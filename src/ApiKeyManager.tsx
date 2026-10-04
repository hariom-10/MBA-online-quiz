import { useState, useEffect, type FormEvent } from "react";
import {
  Key, Plus, Trash2, CheckCircle2, AlertTriangle, ExternalLink, Eye, EyeOff,
  ArrowUp, ArrowDown, Shield, RefreshCw, Sparkles
} from "lucide-react";
import {
  type ApiKeyConfig, type AiProvider, PROVIDER_PRESETS, getRankedApiKeys,
  addOrUpdateApiKey, deleteApiKey, setApiKeyStatus, moveApiKeyRank, validateApiKey
} from "./aiApiKeyStore";

export function ApiKeyManager({ onClosed }: { onClosed?: () => void }) {
  const [keys, setKeys] = useState<ApiKeyConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states matching screenshot
  const [rank, setRank] = useState<number>(1);
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [model, setModel] = useState<string>("gemini-2.5-flash");
  const [customModelInput, setCustomModelInput] = useState<string>("");
  const [secretKey, setSecretKey] = useState<string>("");
  const [showSecret, setShowSecret] = useState<boolean>(false);

  const [validating, setValidating] = useState<boolean>(false);
  const [validationMessage, setValidationMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadKeys();
  }, []);

  function loadKeys() {
    const loaded = getRankedApiKeys();
    setKeys(loaded);
    setRank(loaded.length + 1);
  }

  const currentProviderInfo = PROVIDER_PRESETS[provider];

  function handleProviderChange(newProvider: AiProvider) {
    setProvider(newProvider);
    const defaultMod = PROVIDER_PRESETS[newProvider].defaultModel;
    setModel(defaultMod);
    setCustomModelInput("");
    setValidationMessage(null);
  }

  function handleEdit(keyConfig: ApiKeyConfig) {
    setEditingId(keyConfig.id);
    setRank(keyConfig.rank);
    setProvider(keyConfig.provider);
    if (PROVIDER_PRESETS[keyConfig.provider].models.includes(keyConfig.model)) {
      setModel(keyConfig.model);
      setCustomModelInput("");
    } else {
      setModel("custom");
      setCustomModelInput(keyConfig.model);
    }
    setSecretKey(keyConfig.secretKey);
    setShowForm(true);
    setValidationMessage(null);
  }

  function handleCancelForm() {
    setShowForm(false);
    setEditingId(null);
    setSecretKey("");
    setValidationMessage(null);
    onClosed?.();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const finalModel = model === "custom" ? customModelInput.trim() : model;
    if (!secretKey.trim()) {
      setValidationMessage({ type: "error", text: "Please enter a valid Secret API Key." });
      return;
    }
    if (!finalModel) {
      setValidationMessage({ type: "error", text: "Please select or specify an AI model." });
      return;
    }

    setValidating(true);
    setValidationMessage(null);

    const check = await validateApiKey(provider, secretKey, finalModel);
    setValidating(false);

    if (!check.success) {
      setValidationMessage({ type: "error", text: `Validation failed: ${check.message}` });
      return;
    }

    const updatedList = addOrUpdateApiKey({
      id: editingId || undefined,
      rank,
      provider,
      providerName: currentProviderInfo.name,
      model: finalModel,
      secretKey: secretKey.trim(),
      status: "active",
    });

    setKeys(updatedList);
    setValidationMessage({ type: "success", text: "API Key validated and saved successfully!" });
    setTimeout(() => {
      handleCancelForm();
    }, 1200);
  }

  async function testKey(keyConfig: ApiKeyConfig) {
    setValidating(true);
    const check = await validateApiKey(keyConfig.provider, keyConfig.secretKey, keyConfig.model);
    setValidating(false);
    if (check.success) {
      setKeys(setApiKeyStatus(keyConfig.id, "active"));
      alert(`Success! Key Rank #${keyConfig.rank} (${keyConfig.providerName}) is active and functional.`);
    } else {
      setKeys(setApiKeyStatus(keyConfig.id, "invalid", check.message));
      alert(`Key Validation Failed: ${check.message}`);
    }
  }

  function maskKey(key: string) {
    if (!key) return "••••••••";
    if (key.length <= 12) return "••••" + key.slice(-4);
    return key.slice(0, 6) + "••••••••" + key.slice(-4);
  }

  return (
    <div className="api-key-manager-wrapper">
      <div className="api-key-header-bar">
        <div>
          <span className="eyebrow"><Sparkles size={13} /> MULTI-KEY FAILOVER SYSTEM</span>
          <h2>AI API Keys &amp; Priority Pool</h2>
          <p>Add backup API keys to automatically prevent rate limit and quota errors during PDF processing.</p>
        </div>
        {!showForm && (
          <button
            type="button"
            className="button button-primary add-key-trigger-btn"
            onClick={() => {
              setEditingId(null);
              setRank(keys.length + 1);
              setSecretKey("");
              setValidationMessage(null);
              setShowForm(true);
            }}
          >
            <Plus size={16} /> Add New API Key
          </button>
        )}
      </div>

      {/* FORM CARD MATCHING USER SCREENSHOT DESIGN */}
      {showForm && (
        <div className="api-key-card-form">
          <div className="api-key-card-header">
            <div>
              <h3 className="card-title">CONNECT &amp; RANK NEW API KEY</h3>
              <p className="card-subtitle">
                Input API details and set its priority rank. Safely encrypted in browser storage.
              </p>
            </div>
            <a
              href={currentProviderInfo.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="get-key-link-btn"
            >
              <Key size={14} /> GET {currentProviderInfo.name.toUpperCase()} KEY <ExternalLink size={13} />
            </a>
          </div>

          {validationMessage && (
            <div className={`form-alert-banner alert-${validationMessage.type}`}>
              {validationMessage.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{validationMessage.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="api-key-form-grid">
            <div className="form-fields-row">
              {/* PRIORITY RANK */}
              <div className="form-field-group">
                <label className="field-label">PRIORITY RANK</label>
                <select
                  className="form-select-dark"
                  value={rank}
                  onChange={(e) => setRank(Number(e.target.value))}
                >
                  {Array.from({ length: Math.max(10, keys.length + 2) }, (_, i) => i + 1).map((r) => (
                    <option key={r} value={r}>
                      {r === 1 ? `Rank #${r} (Primary)` : `Rank #${r} (Backup)`}
                    </option>
                  ))}
                </select>
              </div>

              {/* AI PROVIDER */}
              <div className="form-field-group">
                <label className="field-label">AI PROVIDER</label>
                <select
                  className="form-select-dark"
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">Custom / OpenAI Compatible</option>
                </select>
              </div>

              {/* AI MODEL */}
              <div className="form-field-group">
                <label className="field-label">AI MODEL</label>
                <select
                  className="form-select-dark"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {currentProviderInfo.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="custom">Custom Model Name...</option>
                </select>
                {model === "custom" && (
                  <input
                    type="text"
                    className="form-input-dark custom-model-input"
                    placeholder="e.g. google/gemini-2.0-flash-exp:free"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    required
                  />
                )}
              </div>

              {/* SECRET KEY * */}
              <div className="form-field-group secret-key-group">
                <label className="field-label">SECRET KEY *</label>
                <div className="input-with-icon">
                  <input
                    type={showSecret ? "text" : "password"}
                    className="form-input-dark"
                    placeholder={`Key for ${currentProviderInfo.name}...`}
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowSecret(!showSecret)}
                    tabIndex={-1}
                    aria-label="Toggle secret visibility"
                  >
                    {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="form-actions-row">
              <button
                type="button"
                className="btn-cancel-dark"
                onClick={handleCancelForm}
                disabled={validating}
              >
                CANCEL
              </button>
              <button
                type="submit"
                className="btn-validate-yellow"
                disabled={validating}
              >
                {validating ? (
                  <>
                    <RefreshCw size={15} className="spin-icon" /> VALIDATING KEY...
                  </>
                ) : (
                  `VALIDATE & ADD TO RANK #${rank}`
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SAVED API KEYS LIST TABLE */}
      <div className="saved-keys-table-card">
        <div className="table-card-title">
          <h3>ACTIVE &amp; RANKED KEY POOL ({keys.length})</h3>
          <p>
            When a key exceeds quota or rate limits during analysis, the system automatically falls back to the next backup rank.
          </p>
        </div>

        {keys.length === 0 ? (
          <div className="empty-keys-box">
            <Shield size={32} />
            <p>No custom API keys connected yet. Default system `.env` key is currently being used.</p>
            <button
              type="button"
              className="button button-outline"
              onClick={() => setShowForm(true)}
            >
              <Plus size={15} /> Connect First Ranked API Key
            </button>
          </div>
        ) : (
          <div className="keys-table-wrap">
            <table className="keys-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>API Key</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k, index) => (
                  <tr key={k.id} className={k.status === "disabled" ? "row-disabled" : ""}>
                    <td>
                      <span className={`rank-badge ${k.rank === 1 ? "rank-primary" : "rank-backup"}`}>
                        Rank #{k.rank} {k.rank === 1 ? "(Primary)" : "(Backup)"}
                      </span>
                    </td>
                    <td>
                      <b>{k.providerName}</b>
                    </td>
                    <td>
                      <code className="model-code">{k.model}</code>
                    </td>
                    <td>
                      <code className="key-masked">{maskKey(k.secretKey)}</code>
                    </td>
                    <td>
                      <span className={`status-pill-key status-${k.status}`}>
                        {k.status === "active" && "Active"}
                        {k.status === "quota_exceeded" && "Quota Exceeded"}
                        {k.status === "disabled" && "Disabled"}
                        {k.status === "invalid" && "Invalid Key"}
                      </span>
                      {k.lastError && (
                        <small className="key-error-tooltip" title={k.lastError}>
                          {k.lastError.slice(0, 45)}...
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="key-actions">
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Move Rank Up"
                          disabled={index === 0}
                          onClick={() => setKeys(moveApiKeyRank(k.id, "up"))}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Move Rank Down"
                          disabled={index === keys.length - 1}
                          onClick={() => setKeys(moveApiKeyRank(k.id, "down"))}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Test &amp; Verify Key"
                          onClick={() => void testKey(k)}
                        >
                          <RefreshCw size={15} />
                        </button>
                        <button
                          type="button"
                          className="action-text-btn"
                          onClick={() =>
                            setKeys(setApiKeyStatus(k.id, k.status === "disabled" ? "active" : "disabled"))
                          }
                        >
                          {k.status === "disabled" ? "Enable" : "Disable"}
                        </button>
                        <button
                          type="button"
                          className="action-text-btn"
                          onClick={() => handleEdit(k)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="action-delete-btn"
                          title="Delete Key"
                          onClick={() => {
                            if (window.confirm(`Delete API Key Rank #${k.rank} (${k.providerName})?`)) {
                              setKeys(deleteApiKey(k.id));
                            }
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
