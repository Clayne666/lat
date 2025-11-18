(() => {
    const STORAGE_KEY = "leanampCrmRecords";
    const NAV_TRANSFER_KEY = "leanampCrmTransfer";
    const CRM_API_BASE = "/api/crm-records";
    const AUTH_TOKEN_KEY = "leanampAuthToken";
    const STAGE_ORDER = ["Prospect", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];
    const STAGE_WEIGHTS = {
        "Prospect": 0.2,
        "Qualified": 0.35,
        "Proposal": 0.55,
        "Negotiation": 0.75,
        "Closed Won": 1,
        "Closed Lost": 0
    };

    let quoteContext = null;
    let dashboardContext = null;
    let quoteChart = null;
    let dashboardChart = null;
    let hydratePromise = null;

    const hasAuthToken = () => Boolean(localStorage.getItem(AUTH_TOKEN_KEY));

    function authHeaders() {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (!token) throw new Error("Authentication required");
        return { Authorization: `Bearer ${token}` };
    }

    async function fetchCrmApi(path, options = {}) {
        if (!hasAuthToken()) return null;
        const headers = options.body
            ? { "Content-Type": "application/json", ...(options.headers || {}) }
            : { ...(options.headers || {}) };
        const response = await fetch(path, {
            ...options,
            headers: { ...headers, ...authHeaders() }
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `CRM request failed (${response.status})`);
        }
        if (response.status === 204) return null;
        return response.json();
    }

    async function syncRecordsToSharePoint(records) {
        if (!hasAuthToken()) return;
        try {
            await fetchCrmApi(CRM_API_BASE, {
                method: "PUT",
                body: JSON.stringify(records)
            });
        } catch (err) {
            console.error("Unable to sync CRM records to SharePoint", err);
        }
    }

    async function hydrateRecordsFromSharePoint() {
        if (hydratePromise || !hasAuthToken()) return;
        hydratePromise = (async () => {
            try {
                const records = await fetchCrmApi(CRM_API_BASE);
                if (Array.isArray(records)) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
                    notifyChange();
                }
            } catch (err) {
                console.warn("Unable to hydrate CRM from SharePoint", err);
            }
        })();
        return hydratePromise.finally(() => {
            hydratePromise = null;
        });
    }

    const currencyFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

    function escapeHTML(str = "") {
        return str.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }

    function loadRecords() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch (err) {
            console.warn("Unable to parse CRM store, resetting.", err);
            localStorage.removeItem(STORAGE_KEY);
            return [];
        }
    }

    function saveRecords(records) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        syncRecordsToSharePoint(records);
    }

    function persistForNavigation(records) {
        try {
            sessionStorage.setItem(NAV_TRANSFER_KEY, JSON.stringify(records));
        } catch (err) {
            console.warn("Unable to persist CRM for navigation", err);
        }
    }

    function consumeNavigationTransfer() {
        try {
            const payload = sessionStorage.getItem(NAV_TRANSFER_KEY);
            if (!payload) return;
            sessionStorage.removeItem(NAV_TRANSFER_KEY);
            const parsed = JSON.parse(payload);
            if (Array.isArray(parsed)) {
                saveRecords(parsed);
            }
        } catch (err) {
            console.warn("Unable to consume CRM transfer", err);
        }
    }
    consumeNavigationTransfer();
    hydrateRecordsFromSharePoint();

    function getSortedRecords() {
        return loadRecords().sort((a, b) => {
            const stageOrder = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
            if (stageOrder !== 0) return stageOrder;
            return (new Date(b.updatedAt || b.createdAt || 0)) - (new Date(a.updatedAt || a.createdAt || 0));
        });
    }

    function formatCurrency(num) {
        return currencyFormatter.format(Math.max(0, Number(num) || 0));
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (isNaN(date)) return "—";
        return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function formatDateTime(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (isNaN(date)) return "—";
        return date.toLocaleString();
    }

    function computeMetrics(records) {
        const active = records.filter(record => record.stage !== "Closed Lost").length;
        const pipeline = records.filter(record => record.stage !== "Closed Lost")
            .reduce((sum, record) => sum + (Number(record.value) || 0), 0);
        const weighted = records.reduce((sum, record) => {
            const weight = STAGE_WEIGHTS[record.stage] ?? 0.1;
            return sum + ((Number(record.value) || 0) * weight);
        }, 0);
        const won = records.filter(record => record.stage === "Closed Won").length;
        const lost = records.filter(record => record.stage === "Closed Lost").length;
        const nextTouches = records.filter(record => {
            if (!record.nextDate) return false;
            const date = new Date(record.nextDate);
            if (isNaN(date)) return false;
            const now = new Date();
            const diffDays = (date - now) / (1000 * 60 * 60 * 24);
            return diffDays >= 0 && diffDays <= 7;
        }).length;

        return { active, pipeline, weighted, won, lost, nextTouches };
    }

    function getUpcoming(records, limit = 4) {
        return records
            .filter(record => record.nextDate)
            .sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate))
            .slice(0, limit);
    }

    function buildRecordHTML(record, options = {}) {
        const readOnly = options.readOnly ?? false;
        const loadBasePath = options.loadBasePath || "calcandquote.html";
        const showLoadLink = !!options.showLoadLink && !!record.calcSnapshot;
        const actionItems = [];
        if (!readOnly) {
            const stageOptions = STAGE_ORDER.map(stage => `
                <option value="${stage}" ${record.stage === stage ? "selected" : ""}>${stage}</option>
            `).join("");
            actionItems.push(`
                <label>Stage
                    <select class="crm-stage-select" data-id="${record.id}">
                        ${stageOptions}
                    </select>
                </label>
            `);
            actionItems.push(`
                <button type="button" class="crm-remove-btn" data-id="${record.id}">
                    <i class="fas fa-trash"></i> Remove
                </button>
            `);
        }
        if (showLoadLink) {
            actionItems.push(`
                <a class="crm-load-btn" href="${loadBasePath}?crmRecord=${record.id}" target="_blank" rel="noopener noreferrer">
                    <i class="fas fa-plug"></i> Load in Calculator
                </a>
            `);
        }
        if (options.allowEdit) {
            actionItems.push(`
                <button type="button" class="crm-edit-btn" data-id="${record.id}">
                    <i class="fas fa-edit"></i> Edit
                </button>
            `);
        }
        const actionsHtml = actionItems.length ? `<div class="crm-record-actions">${actionItems.join('')}</div>` : "";
        return `
            <div class="crm-record">
                <div class="crm-record-header">
                    <div>
                        <strong>${escapeHTML(record.name || "Unnamed Contact")}</strong>
                        <small class="crm-assigned">Assigned to: ${escapeHTML(record.assignedTo || "Unassigned")}</small>
                    </div>
                    <span class="crm-tag">${escapeHTML(record.stage || "Prospect")}</span>
                </div>
                <div class="crm-record-body">
                    <div>
                        <small>Company</small>
                        <strong>${escapeHTML(record.company || "—")}</strong>
                    </div>
                    <div>
                        <small>Project</small>
                        <strong>${escapeHTML(record.projectName || "—")}</strong>
                    </div>
                    <div>
                        <small>Email / Phone</small>
                        <strong>
                            ${record.email ? `<a href="mailto:${escapeHTML(record.email)}">${escapeHTML(record.email)}</a>` : "—"}
                            ${record.phone ? `<br>${escapeHTML(record.phone)}` : ""}
                        </strong>
                    </div>
                    <div>
                        <small>Address</small>
                        <strong>${escapeHTML(record.projectAddress || "—")}</strong>
                    </div>
                    <div>
                        <small>Value</small>
                        <strong>${formatCurrency(record.value)}</strong>
                    </div>
                    <div>
                        <small>Next Action</small>
                        <strong>${escapeHTML(record.nextAction || "—")} ${record.nextDate ? `<br>${formatDate(record.nextDate)}` : ""}</strong>
                    </div>
                    <div>
                        <small>Notes</small>
                        <strong>${escapeHTML(record.notes || "—")}</strong>
                    </div>
                    <div>
                        <small>Updated</small>
                        <strong>${formatDateTime(record.updatedAt) || "Just now"}</strong>
                    </div>
                </div>
                ${actionsHtml}
            </div>
        `;
    }

    function renderRecords(container, records, options = {}) {
        if (!container) return;
        if (!records.length) {
            container.innerHTML = `<div class="empty-state"><strong>No records yet</strong><p>Log prospects, customers, or partners and keep every follow-up synced.</p></div>`;
            return;
        }
        container.innerHTML = records.map(record => buildRecordHTML(record, options)).join("");
    }

    function renderNextSteps(container, records) {
        if (!container) return;
        if (!records.length) {
            container.innerHTML = `<div class="empty-state"><p>No scheduled touches. Set a cadence to keep deals warm.</p></div>`;
            return;
        }
        container.innerHTML = records.map(record => `
            <div class="next-step-card">
                <strong>${escapeHTML(record.nextAction || "Follow up")} • ${formatDate(record.nextDate)}</strong>
                <span>${escapeHTML(record.name || record.company || "Contact")} — ${escapeHTML(record.stage || "Prospect")}</span>
            </div>
        `).join("");
    }

    function renderMetrics(metrics, nodes = {}) {
        const assign = (el, value, isCurrency = false) => {
            if (!el) return;
            el.textContent = isCurrency ? formatCurrency(value) : value;
        };
        assign(nodes.active, metrics.active);
        assign(nodes.pipeline, metrics.pipeline, true);
        assign(nodes.weighted, metrics.weighted, true);
        assign(nodes.nextTouches, metrics.nextTouches);
        assign(nodes.won, metrics.won);
        assign(nodes.lost, metrics.lost);
    }

    function updateSuggestionLists(records, datalists) {
        if (!datalists) return;
        const unique = values => [...new Set(values.filter(Boolean).map(value => value.trim()))];
        const buildOptions = values => unique(values).map(value => `<option value="${escapeHTML(value)}"></option>`).join("");
        if (datalists.contact) datalists.contact.innerHTML = buildOptions(records.map(record => record.name));
        if (datalists.company) datalists.company.innerHTML = buildOptions(records.map(record => record.company));
        if (datalists.project) datalists.project.innerHTML = buildOptions(records.map(record => record.projectName));
        if (datalists.address) datalists.address.innerHTML = buildOptions(records.map(record => record.projectAddress));
        if (datalists.email) datalists.email.innerHTML = buildOptions(records.map(record => record.email));
        if (datalists.phone) datalists.phone.innerHTML = buildOptions(records.map(record => record.phone));
    }

    function renderChart(canvas, records, existingChart) {
        if (!canvas || !window.Chart) return existingChart;
        const ctx = canvas.getContext("2d");
        const data = {
            labels: STAGE_ORDER,
            datasets: [{
                data: STAGE_ORDER.map(stage => records.filter(record => record.stage === stage).length),
                backgroundColor: ["#9AE6B4", "#68D391", "#4FD1C5", "#63B3ED", "#F6AD55", "#FEB2B2"],
                borderColor: "#fff",
                borderWidth: 1
            }]
        };
        if (existingChart) {
            existingChart.data = data;
            existingChart.update();
            return existingChart;
        } 
        return new Chart(ctx, {
                type: "doughnut",
                data,
                options: {
                    cutout: "65%",
                    plugins: { legend: { position: "bottom" } }
                }
        });
    }

    function applyPresetToDate(selectEl, dateInput) {
        if (!selectEl || !dateInput) return;
        const value = selectEl.value;
        if (!value) {
            dateInput.disabled = false;
            dateInput.value = "";
            return;
        }
        if (value === "custom") {
            dateInput.disabled = false;
            dateInput.value = "";
            dateInput.focus();
            return;
        }
        const days = Number(value);
        const target = new Date();
        target.setDate(target.getDate() + days);
        dateInput.disabled = true;
        dateInput.value = target.toISOString().slice(0, 10);
    }

    function notifyChange() {
        if (quoteContext) refreshQuoteContext();
        if (dashboardContext) refreshDashboardContext();
    }

    function refreshQuoteContext() {
        if (!quoteContext) return;
        const records = getSortedRecords();
        renderRecords(quoteContext.listEl, records, { readOnly: false });
        renderNextSteps(quoteContext.nextStepsEl, getUpcoming(records, 4));
        renderMetrics(computeMetrics(records), quoteContext.metrics);
        quoteChart = renderChart(quoteContext.chartEl, records, quoteChart);
        updateSuggestionLists(records, quoteContext.datalists);
    }

    function refreshDashboardContext() {
        if (!dashboardContext) return;
        const records = getSortedRecords();
        renderRecords(dashboardContext.listEl, records, { readOnly: true, showLoadLink: true, allowEdit: true, loadBasePath: dashboardContext.loadBasePath || "calcandquote.html" });
        renderNextSteps(dashboardContext.nextStepsEl, getUpcoming(records, 6));
        renderMetrics(computeMetrics(records), dashboardContext.metrics);
        dashboardChart = renderChart(dashboardContext.chartEl, records, dashboardChart);
    }

    function updateRecord(id, updates = {}) {
        const records = loadRecords();
        const record = records.find(item => item.id === id);
        if (!record) return false;
        Object.assign(record, updates, { updatedAt: new Date().toISOString() });
        saveRecords(records);
        notifyChange();
        return true;
    }

    function initQuoteCRM(config = {}) {
        const form = document.getElementById(config.formId || "crmForm");
        if (!form) return;
        const snapshotProvider = config.snapshotProvider;
        quoteContext = {
            form,
            statusEl: document.getElementById(config.statusId || "crmStatus"),
            listEl: document.getElementById(config.listId || "crmList"),
            chartEl: document.getElementById(config.chartId || "crmStageChart"),
            nextStepsEl: document.getElementById(config.nextStepsId || "crmNextSteps"),
            datalists,
            metrics: {
                active: document.getElementById(config.metrics?.activeId || "crmActiveDeals"),
                pipeline: document.getElementById(config.metrics?.pipelineId || "crmPipelineValue"),
                weighted: document.getElementById(config.metrics?.weightedId || "crmWeightedValue"),
                nextTouches: document.getElementById(config.metrics?.nextTouchesId || "crmNextTouchCount")
            }
        };

        const stageSelect = document.getElementById(config.stageFieldId || "crmStage");
        const presetSelect = document.getElementById(config.nextPresetId || "crmNextPreset");
        const dateInput = document.getElementById(config.nextDateId || "crmNextDate");
        const emailInput = form.querySelector("#crmEmail");
        const companyInput = form.querySelector("#customerName");
        const nameInput = form.querySelector("#customerContact");
        const phoneInput = form.querySelector("#crmPhone");
        const valueInput = form.querySelector("#crmValue");
        const projectInput = form.querySelector("#projectName");
        const addressInput = form.querySelector("#customerAddress");
        const nextActionHidden = document.getElementById("crmNextAction");
        const nextActionSelect = document.getElementById("crmNextActionSelect");
        const nextActionCustom = document.getElementById("crmNextActionCustom");
        const notesInput = form.querySelector("#crmNotes");
        const presetLabel = document.getElementById("crmNextPresetLabel");
        const datalists = {
            contact: document.getElementById("crmContactSuggestions"),
            company: document.getElementById("crmCompanySuggestions"),
            address: document.getElementById("crmAddressSuggestions"),
            project: document.getElementById("crmProjectSuggestions"),
            email: document.getElementById("crmEmailSuggestions"),
            phone: document.getElementById("crmPhoneSuggestions")
        };

        const formatPhone = value => {
            if (!value) return "";
            const digits = value.replace(/\D+/g, "");
            if (digits.length <= 3) return digits;
            if (digits.length <= 6) return `${digits.slice(0,3)}-${digits.slice(3)}`;
            return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6,10)}`;
        };

        if (phoneInput) {
            phoneInput.addEventListener("input", () => {
                const start = phoneInput.selectionStart;
                const formatted = formatPhone(phoneInput.value);
                phoneInput.value = formatted;
                phoneInput.setSelectionRange(formatted.length, formatted.length);
            });
        }

        const syncNextAction = () => {
            if (!nextActionHidden) return;
            if (nextActionSelect && nextActionSelect.value === "custom") {
                nextActionHidden.value = nextActionCustom?.value?.trim() || "";
            } else if (nextActionSelect) {
                nextActionHidden.value = nextActionSelect.value;
            }
        };

        if (nextActionSelect) {
            syncNextAction();
            nextActionSelect.addEventListener("change", () => {
                if (nextActionSelect.value === "custom") {
                    if (nextActionCustom) {
                        nextActionCustom.style.display = "block";
                        nextActionCustom.focus();
                    }
                } else if (nextActionCustom) {
                    nextActionCustom.style.display = "none";
                    nextActionCustom.value = "";
                }
                syncNextAction();
            });
        }
        if (nextActionCustom) {
            nextActionCustom.addEventListener("input", syncNextAction);
        }

        const updatePresetLabel = () => {
            if (!presetLabel || !presetSelect) return;
            const text = presetSelect.options[presetSelect.selectedIndex]?.text || "No cadence selected";
            presetLabel.textContent = `Selected: ${text}`;
        };

        if (presetSelect && dateInput) {
            applyPresetToDate(presetSelect, dateInput);
            presetSelect.addEventListener("change", () => {
                applyPresetToDate(presetSelect, dateInput);
                updatePresetLabel();
            });
            updatePresetLabel();
        }

        const saveBtn = document.getElementById(config.saveBtnId || "crmSaveBtn");
        const resetBtn = document.getElementById(config.resetBtnId || "crmResetBtn");
        const setStatus = (message, tone = "info") => {
            if (!quoteContext.statusEl) return;
            quoteContext.statusEl.textContent = message;
            quoteContext.statusEl.classList.remove("status-success", "status-error");
            if (tone === "success") quoteContext.statusEl.classList.add("status-success");
            if (tone === "error") quoteContext.statusEl.classList.add("status-error");
        };
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                if (stageSelect) stageSelect.value = "Qualified";
                if (presetSelect) presetSelect.value = "";
                if (dateInput) { dateInput.disabled = false; dateInput.value = ""; }
                if (nextActionSelect) nextActionSelect.value = "Send PDF proposal";
                if (nextActionCustom) {
                    nextActionCustom.style.display = "none";
                    nextActionCustom.value = "";
                }
                syncNextAction();
                [emailInput, phoneInput, valueInput, notesInput].forEach(input => {
                    if (input) {
                        if (input === valueInput) {
                            input.value = "";
                            input.removeAttribute("data-quote-override");
                        } else {
                            input.value = "";
                        }
                    }
                });
                setStatus("Form cleared.", "info");
            });
        }

        function autofillFromRecord(record, options = {}) {
            if (!record) return;
            const forceInputs = options.forceInputs || [];
            const shouldForce = input => !!(input && forceInputs.includes(input));
            const assign = (input, value, always = false) => {
                if (!input || value === undefined || value === null) return;
                if (always || shouldForce(input) || !input.value) input.value = value;
            };
            assign(nameInput, record.name);
            assign(companyInput, record.company, true);
            assign(emailInput, record.email);
            assign(phoneInput, record.phone);
            assign(projectInput, record.projectName);
            assign(addressInput, record.projectAddress);
            if (quoteContext.statusEl) {
                quoteContext.statusEl.textContent = `Loaded existing CRM record for ${record.name || record.company}.`;
                quoteContext.statusEl.style.color = "var(--primary-green)";
            }
        }

        function attemptAutofillBy(predicate, options = {}) {
            const records = loadRecords();
            const record = records.find(predicate);
            if (record) {
                autofillFromRecord(record, options);
            }
        }

        function registerLookupTrigger(input, predicateBuilder) {
            if (!input) return;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                const val = input.value.trim().toLowerCase();
                if (!val) return;
                attemptAutofillBy(predicateBuilder(val), { forceInputs: [input] });
            });
        }

        registerLookupTrigger(emailInput, val => record => (record.email || "").toLowerCase().includes(val));
        registerLookupTrigger(companyInput, val => record => (record.company || "").toLowerCase().includes(val));
        registerLookupTrigger(nameInput, val => record => (record.name || "").toLowerCase().includes(val));
        registerLookupTrigger(phoneInput, val => record => (record.phone || "").toLowerCase().includes(val));
        registerLookupTrigger(projectInput, val => record => (record.projectName || "").toLowerCase().includes(val));
        registerLookupTrigger(addressInput, val => record => (record.projectAddress || "").toLowerCase().includes(val));

        const requiredFields = [
            { el: projectInput, name: "Project Name" },
            { el: companyInput, name: "Customer / Company" }
        ];

        const processSubmission = () => {
            for (const field of requiredFields) {
                if (!field.el || !field.el.value.trim()) {
                    setStatus(`Please fill ${field.name} before saving.`, "error");
                    field.el?.focus();
                    return;
                }
            }
            const records = loadRecords();
            const valueRaw = valueInput ? valueInput.value : "";
            const assignedTo = localStorage.getItem("leanampCurrentUser") || "Unassigned";
            records.push({
                id: Date.now(),
                name: nameInput ? nameInput.value.trim() : "",
                company: companyInput ? companyInput.value.trim() : "",
                email: emailInput ? emailInput.value.trim() : "",
                phone: phoneInput ? phoneInput.value.trim() : "",
                stage: stageSelect ? stageSelect.value : "Prospect",
                value: parseFloat(valueRaw || "") || 0,
                projectName: projectInput ? projectInput.value.trim() : "",
                projectAddress: addressInput ? addressInput.value.trim() : "",
                nextAction: nextActionHidden ? nextActionHidden.value.trim() : "",
                nextDate: dateInput ? dateInput.value : "",
                notes: notesInput ? notesInput.value.trim() : "",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                calcSnapshot: typeof snapshotProvider === "function" ? snapshotProvider() : null,
                assignedTo
            });
            saveRecords(records);
            setStatus("Entry saved to CRM. View it on the dashboard.", "success");
            if (stageSelect) stageSelect.value = "Qualified";
            if (presetSelect) presetSelect.value = "";
            if (dateInput) { dateInput.disabled = false; dateInput.value = ""; }
            if (nextActionSelect) nextActionSelect.value = "Send PDF proposal";
            if (nextActionCustom) {
                nextActionCustom.style.display = "none";
                nextActionCustom.value = "";
            }
            syncNextAction();
            [emailInput, phoneInput, valueInput, notesInput].forEach(input => {
                if (!input) return;
                input.value = "";
                if (input === valueInput) input.removeAttribute("data-quote-override");
            });
            notifyChange();
        };

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            processSubmission();
        });
        if (saveBtn) {
            saveBtn.addEventListener("click", (event) => {
                event.preventDefault();
                processSubmission();
            });
        }

        const exportBtn = document.getElementById(config.exportBtnId || "crmExportBtn");
        if (exportBtn) {
            exportBtn.addEventListener("click", () => {
                const data = loadRecords();
                if (!data.length) {
                    setStatus("CRM is empty. Nothing to export.", "error");
                    return;
                }
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `leanamp-crm-${new Date().toISOString().split("T")[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                setStatus(`Exported ${data.length} CRM record${data.length === 1 ? "" : "s"}.`, "success");
            });
        }

        const importBtn = document.getElementById(config.importBtnId || "crmImportBtn");
        const importInput = document.getElementById(config.importInputId || "crmImportInput");
        if (importBtn && importInput) {
            importBtn.addEventListener("click", () => importInput.click());
            importInput.addEventListener("change", (event) => {
                const files = event.target.files;
                const file = files && files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = e => {
                    try {
                        const payload = JSON.parse(e.target.result);
                        if (!Array.isArray(payload)) throw new Error("CRM file must be an array");
                        saveRecords(payload);
                        setStatus(`Imported ${payload.length} CRM record${payload.length === 1 ? "" : "s"}.`, "success");
                        notifyChange();
                    } catch (err) {
                        const message = err?.message || "Import failed.";
                        setStatus(message, "error");
                    } finally {
                        importInput.value = "";
                    }
                };
                reader.readAsText(file);
            });
        });

        if (quoteContext.listEl) {
            quoteContext.listEl.addEventListener("change", (event) => {
                if (!event.target.matches(".crm-stage-select")) return;
                const id = Number(event.target.getAttribute("data-id"));
                const records = loadRecords();
                const record = records.find(item => item.id === id);
                if (!record) return;
                record.stage = event.target.value;
                record.updatedAt = new Date().toISOString();
                saveRecords(records);
                notifyChange();
            });
            quoteContext.listEl.addEventListener("click", (event) => {
                const btn = event.target.closest(".crm-remove-btn");
                if (!btn) return;
                const id = Number(btn.getAttribute("data-id"));
                let records = loadRecords();
                records = records.filter(record => record.id !== id);
                saveRecords(records);
                notifyChange();
            });
        }

        refreshQuoteContext();
    }

    function initDashboard(config = {}) {
        dashboardContext = {
            listEl: document.getElementById(config.listId || "crmDashboardList"),
            chartEl: document.getElementById(config.chartId || "crmDashboardChart"),
            nextStepsEl: document.getElementById(config.nextStepsId || "crmDashboardNextSteps"),
            loadBasePath: config.loadBasePath || "calcandquote.html",
            metrics: {
                active: document.getElementById(config.metrics?.activeId || "crmDashActive"),
                pipeline: document.getElementById(config.metrics?.pipelineId || "crmDashPipeline"),
                weighted: document.getElementById(config.metrics?.weightedId || "crmDashWeighted"),
                nextTouches: document.getElementById(config.metrics?.nextTouchesId || "crmDashTouches"),
                won: document.getElementById(config.metrics?.wonId || "crmDashWon"),
                lost: document.getElementById(config.metrics?.lostId || "crmDashLost")
            }
        };
        if (dashboardContext.listEl) {
            dashboardContext.listEl.addEventListener("click", (event) => {
                const editBtn = event.target.closest(".crm-edit-btn");
                if (editBtn) {
                    event.preventDefault();
                    const id = Number(editBtn.getAttribute("data-id"));
                    openEditDialog(id);
                }
            });
        }
        refreshDashboardContext();
    }

    function openEditDialog(id) {
        const records = loadRecords();
        const record = records.find(item => item.id === id);
        if (!record) return;
        const fields = [
            { key: "projectName", label: "Project Name" },
            { key: "company", label: "Customer / Company" },
            { key: "projectAddress", label: "Facility Address" },
            { key: "name", label: "Primary Contact" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "stage", label: "Stage" },
            { key: "nextAction", label: "Next Action" },
            { key: "nextDate", label: "Next Touch (YYYY-MM-DD)" },
            { key: "notes", label: "Notes" }
        ];
        const updates = {};
        for (const field of fields) {
            const value = prompt(`Edit ${field.label}`, record[field.key] || "");
            if (value === null) {
                return;
            }
            updates[field.key] = value.trim();
        }
        updateRecord(id, updates);
    }

    function prepareNavigation(next) {
        try {
            persistForNavigation(loadRecords());
        } catch (err) {
            console.warn("Unable to stash CRM data for navigation", err);
        }
        if (typeof next === "function") next();
    }

    window.LeanAmpCRM = {
        initQuoteCRM,
        initDashboard,
        loadRecords,
        saveRecords,
        STAGE_ORDER,
        updateRecord,
        prepareNavigation
    };

    window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEY) {
            notifyChange();
        }
    });
})();
