/**
 * @name RomajiTranslator
 * @description Adds a button to the chat input that translates romaji to Japanese (Kanji, Hiragana, Katakana) using an LLM API.
 * @version 1.0.0
 * @author Adithya
 */

module.exports = class RomajiTranslator {
    constructor() {
        this.api = new BdApi("RomajiTranslator");
        this.defaultSettings = {
            apiKey: "",
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-chat",
            systemPrompt: "You are a Japanese translation assistant. Translate the user's romaji input into natural Japanese. Output ONLY the Japanese translation using appropriate kanji, hiragana, and katakana. Do not include romaji, explanations, or multiple variations. Just the translation."
        };
        this.settings = this.loadSettings();
        this.chatInputModule = null;
        this.inputRef = null;
    }

    // ---- Lifecycle ----
    start() {
        this.api.Logger.info("RomajiTranslator started.");
        this.injectButton();
    }

    stop() {
        this.api.Logger.info("RomajiTranslator stopped.");
        this.api.Patcher.unpatchAll();
        this.api.DOM.removeStyle("romaji-translator-style");
        this.removeButton();
    }

    // ---- Settings ----
    loadSettings() {
        return Object.assign({}, this.defaultSettings, this.api.Data.load("settings"));
    }

    saveSettings() {
        this.api.Data.save("settings", this.settings);
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.style.padding = "10px";
        panel.style.color = "var(--text-normal)";

        const fields = [
            { key: "apiKey", label: "API Key", type: "password" },
            { key: "baseUrl", label: "Base URL", type: "text" },
            { key: "model", label: "Model", type: "text" },
            { key: "systemPrompt", label: "System Prompt", type: "textarea" }
        ];

        fields.forEach(f => {
            const label = document.createElement("label");
            label.style.display = "block";
            label.style.marginBottom = "10px";
            label.textContent = f.label;

            const input = f.type === "textarea"
                ? document.createElement("textarea")
                : document.createElement("input");
            input.type = f.type === "textarea" ? undefined : f.type;
            input.value = this.settings[f.key];
            input.style.width = "100%";
            input.style.marginTop = "4px";
            input.style.padding = "6px";
            input.style.borderRadius = "4px";
            input.style.border = "1px solid var(--background-modifier-accent)";
            input.style.backgroundColor = "var(--background-secondary)";
            input.style.color = "var(--text-normal)";

            input.addEventListener("change", () => {
                this.settings[f.key] = input.value;
                this.saveSettings();
            });

            label.appendChild(input);
            panel.appendChild(label);
        });

        const hint = document.createElement("p");
        hint.textContent = "Works with any OpenAI-compatible API (DeepSeek, OpenAI, etc.).";
        hint.style.fontSize = "12px";
        hint.style.opacity = "0.6";
        panel.appendChild(hint);

        return panel;
    }

    // ---- Find & patch the chat input ----
    injectButton() {
        // Try several known module search strategies.
        // Discord's module names change between updates, so we try multiple filters.
        const filters = [
            () => BdApi.Webpack.getByKeys("ChannelTextArea"),
            () => BdApi.Webpack.getByKeys("ChannelTextAreaContainer"),
            () => BdApi.Webpack.getByStrings("channelTextArea", "placeholder", { searchExports: true }),
            () => BdApi.Webpack.getByStrings("textArea", "placeholder", { searchExports: true }),
        ];

        let module = null;
        for (const f of filters) {
            try {
                module = f();
                if (module) break;
            } catch (e) { /* continue */ }
        }

        if (!module) {
            this.api.Logger.warn("Could not find chat input module. Plugin will not inject button.");
            BdApi.UI.showToast("RomajiTranslator: Could not find chat input. Check console.", { type: "error" });
            return;
        }

        this.chatInputModule = module;

        // Find the component that has a `render` method (class component)
        const target = this.findRenderTarget(module);
        if (!target) {
            this.api.Logger.warn("Could not find render target for chat input.");
            return;
        }

        this.api.Patcher.after("RomajiTranslator", target.prototype, "render", (thisObject, args, returnValue) => {
            try {
                // Capture a reference to the input's value setter if possible
                this.inputRef = thisObject;

                // Inject the button into the rendered tree
                return this.injectIntoTree(returnValue);
            } catch (e) {
                this.api.Logger.error("Injection error:", e);
                return returnValue;
            }
        });
    }

    findRenderTarget(module) {
        // We look for anything with a prototype that has a render method.
        const candidates = [];

        if (typeof module === "function" && module.prototype?.render) {
            candidates.push(module);
        }

        if (module && typeof module === "object") {
            for (const key of Object.keys(module)) {
                const val = module[key];
                if (typeof val === "function" && val.prototype?.render) {
                    candidates.push(val);
                }
            }
        }

        // Prefer components whose name hints at text input
        const named = candidates.find(c =>
            /text.?area|chat.?input|channel.?text/i.test(c.name || "")
        );
        return named || candidates[0] || null;
    }

    injectIntoTree(element) {
        if (!element || typeof element !== "object") return element;

        // If this element is an array, walk children
        if (Array.isArray(element)) {
            return element.map(child => this.injectIntoTree(child));
        }

        // If it's a React element, walk its children
        if (element.props) {
            const newChildren = this.injectIntoTree(element.props.children);
            if (newChildren !== element.props.children) {
                element = { ...element, props: { ...element.props, children: newChildren } };
            }

            // Look for the send button or a good injection point
             if (element.props.children && Array.isArray(element.props.children)) {
                const hasSendButton = element.props.children.some(c =>
                    c?.props?.className?.includes?.("sendButton") ||
                    c?.props?.["aria-label"]?.toLowerCase?.().includes("send")
                );
                if (hasSendButton && !element.props.children.some(c => c?.props?.id === "romaji-translate-btn")) {
                    const btn = this.createButton();
                    // Insert before the send button
                    element.props.children = [
                        ...element.props.children.filter(c => !c?.props?.id?.includes?.("romaji-translate-btn")),
                        btn
                    ];
                }
            }
        }

        return element;
    }

    createButton() {
        // Inject CSS once
        if (!document.getElementById("romaji-translator-style")) {
            const style = document.createElement("style");
            style.id = "romaji-translator-style";
            style.textContent = `
                .romaji-translate-btn {
                    background: transparent;
                    border: none;
                    color: var(--interactive-normal);
                    cursor: pointer;
                    padding: 4px 8px;
                    margin: 0 4px;
                    font-size: 16px;
                    border-radius: 4px;
                    transition: background 0.15s, color 0.15s;
                }
                .romaji-translate-btn:hover {
                    background: var(--background-modifier-hover);
                    color: var(--interactive-hover);
                }
                .romaji-translate-btn:disabled {
                    opacity: 0.5;
                    cursor: wait;
                }
            `;
            document.head.appendChild(style);
        }

        return BdApi.React.createElement("button", {
            id: "romaji-translate-btn",
            className: "romaji-translate-btn",
            title: "Translate Romaji → Japanese",
            onClick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleTranslate(e.currentTarget);
            }
        }, "訳");
    }

    removeButton() {
        const btn = document.getElementById("romaji-translate-btn");
        if (btn) btn.remove();
        const style = document.getElementById("romaji-translator-style");
        if (style) style.remove();
    }

    // ---- Translation logic ----
    getInputText() {
        // try the captured component instance's state
        const inst = this.inputRef;
        if (inst) {
            // Common state shapes in Discord's chat input
            const candidates = [
                inst.state?.textValue,
                inst.state?.value,
                inst.props?.value,
                inst.props?.textValue
            ];
            for (const c of candidates) {
                if (typeof c === "string" && c.length > 0) return c;
            }
        }
    }

    setInputText(text) {
        const inst = this.inputRef;

        // React state
        if (inst && typeof inst.setState === "function") {
            // Try common state key names
            const stateKeys = ["textValue", "value"];
            for (const key of stateKeys) {
                try {
                    inst.setState({ [key]: text });
                    // Verify it took effect
                    if (inst.state?.[key] === text) return true;
                } catch (e) { /* ignore */ }
            }
        }
    }

    async handleTranslate(buttonEl) {
        const text = this.getInputText();
        if (!text || text.trim().length === 0) {
            BdApi.UI.showToast("Nothing to translate.", { type: "warning" });
            return;
        }

        if (!this.settings.apiKey) {
            BdApi.UI.showToast("Set your API key in the plugin settings first.", { type: "error" });
            return;
        }

        buttonEl.disabled = true;
        const originalContent = buttonEl.textContent;
        buttonEl.textContent = "…";

        try {
            const translated = await this.callLLM(text);
            if (!translated) {
                throw new Error("Empty response from API.");
            }

            const success = this.setInputText(translated);
            if (success) {
                BdApi.UI.showToast(`Translated: ${translated}`, { type: "success" });
            } else {
                BdApi.UI.showToast("Translation received but could not update input.", { type: "warning" });
                this.api.Logger.warn("Translated text:", translated);
            }
        } catch (err) {
            this.api.Logger.error("Translation failed:", err);
            BdApi.UI.showToast(`Translation failed: ${err.message}`, { type: "error", timeout: 5000 });
        } finally {
            buttonEl.disabled = false;
            buttonEl.textContent = originalContent;
        }
    }

    async callLLM(romajiText) {
        const url = `${this.settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;

        const body = {
            model: this.settings.model,
            messages: [
                { role: "system", content: this.settings.systemPrompt },
                { role: "user", content: romajiText }
            ],
            temperature: 0.3,
            max_tokens: 200
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.settings.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new Error(`API ${response.status}: ${errText.slice(0, 120)}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("No translation content in API response.");
        }
        return content.trim();
    }
};