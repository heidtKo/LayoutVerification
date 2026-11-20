import { LightningElement, api, wire } from "lwc";
import { CurrentPageReference } from "lightning/navigation";
import { getRecord, updateRecord } from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import ID_FIELD from "@salesforce/schema/copado__ExtensionConfiguration__c.Id";
import DETAILS_FIELD from "@salesforce/schema/copado__ExtensionConfiguration__c.copado__Details__c";

const NEW_FILE_DEFAULTS = {
    file: "",
    sections: [],
    keepSequence: false,
    order: true,
};

// Radio values. "order" and "keepSequence" map to the boolean keys stored in
// the copado__Details__c JSON. "none" means both booleans are false, which is
// a valid legacy state, so it stays selectable.
const FLAG_ORDER = "order";
const FLAG_KEEP_SEQUENCE = "keepSequence";
const FLAG_NONE = "none";

const FLAG_OPTIONS = [
    { label: "Order", value: FLAG_ORDER },
    { label: "Keep sequence", value: FLAG_KEEP_SEQUENCE },
    { label: "None", value: FLAG_NONE },
];

// Filter for the pipeline record picker (active pipelines only).
const PIPELINE_FILTER = {
    criteria: [
        {
            fieldPath: "copado__Active__c",
            operator: "eq",
            value: true,
        },
    ],
};

function errorMessage(error) {
    if (Array.isArray(error?.body)) {
        return error.body.map((e) => e.message).join(", ");
    }
    return error?.body?.message || error?.message || "Unknown error";
}

export default class LayoutSectionsSettings extends LightningElement {
    @api recordId;
    @api objectApiName;

    // View state
    pipeline = null;
    files = [];
    isLoading = true;
    isSaving = false;
    isDirty = false;
    parseWarning = false;
    showPipelineError = false;
    loadFailed = false;

    // Internal bookkeeping
    _pageRecordId;
    _loadTimer;
    _keyCounter = 0;
    _savedJson;
    _initialized = false;

    @wire(CurrentPageReference)
    wiredPageRef(ref) {
        this._pageRecordId = ref?.attributes?.recordId;
    }

    get effectiveRecordId() {
        return this.recordId || this._pageRecordId;
    }

    connectedCallback() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._loadTimer = setTimeout(() => {
            if (this.isLoading) {
                this.isLoading = false;
                this.loadFailed = true;
            }
        }, 4000);
    }

    disconnectedCallback() {
        clearTimeout(this._loadTimer);
    }

    @wire(getRecord, { recordId: "$effectiveRecordId", fields: [DETAILS_FIELD] })
    wiredRecord({ data, error }) {
        if (data) {
            this.loadFailed = false;
            const raw = data.fields.copado__Details__c.value;
            // Ignore the refresh that follows our own save, so local UI state
            // (such as expanded sections) is not reset.
            if (this._initialized && raw === this._savedJson) {
                return;
            }
            this._savedJson = raw;
            try {
                this.applyJson(raw);
            } catch (e) {
                // Never leave the spinner running because of unexpected stored data.
                this.parseWarning = true;
                this.files = [];
                this.pipeline = null;
                this.isDirty = false;
            }
            this._initialized = true;
            this.isLoading = false;
        } else if (error) {
            this.isLoading = false;
            this.showToast(
                "Could not load configuration",
                errorMessage(error),
                "error",
            );
        }
    }

    applyJson(raw) {
        this.parseWarning = false;
        let cfg = {};
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                cfg = parsed && typeof parsed === "object" ? parsed : {};
            } catch (e) {
                this.parseWarning = true;
            }
        }
        this.pipeline = cfg.pipeline || null;
        const files = Array.isArray(cfg.files)
            ? cfg.files.filter((f) => f && typeof f === "object")
            : [];
        this.files = files.map((f) =>
            this.buildFile({
                file: f.file,
                sections: f.sections,
                keepSequence: f.keepSequence,
                order: f.order,
            }),
        );
        this.isDirty = false;
    }

    /* ---------------------------------------------------------------
     * View model
     * ------------------------------------------------------------- */
    get pipelineFilter() {
        return PIPELINE_FILTER;
    }

    get displayFiles() {
        return this.files.map((f, index) => ({
            ...f,
            fileLabel: `File ${index + 1}`,
            sectionsLabel: `Sections (${f.sections.length})`,
            hasNoSections: f.sections.length === 0,
            ariaExpanded: String(f.expanded),
            sectionClass: `slds-section slds-m-top_small${f.expanded ? " slds-is-open" : ""}`,
            // Each file gets its own copy of the options.
            flagOptions: FLAG_OPTIONS.map((o) => ({ ...o })),
            flagValue: f.order
                ? FLAG_ORDER
                : f.keepSequence
                  ? FLAG_KEEP_SEQUENCE
                  : FLAG_NONE,
            sections: f.sections.map((s, i) => ({ ...s, label: `Section ${i + 1}` })),
        }));
    }

    get fileCount() {
        return this.files.length;
    }

    get hasNoFiles() {
        return this.files.length === 0;
    }

    get isBusy() {
        return this.isLoading || this.isSaving;
    }

    get isSaveDisabled() {
        return !this.isDirty || this.isBusy;
    }

    get isResetDisabled() {
        return !this.isDirty || this.isBusy;
    }

    get pipelineFormClass() {
        return `slds-form-element${this.showPipelineError ? " slds-has-error" : ""}`;
    }

    /* ---------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------- */
    nextKey(prefix) {
        this._keyCounter += 1;
        return `${prefix}-${this._keyCounter}`;
    }

    buildFile(src = NEW_FILE_DEFAULTS) {
        const order = Boolean(src.order);
        return {
            key: this.nextKey("f"),
            file: src.file || "",
            order,
            // Mutually exclusive: if legacy data has both true, "order" wins.
            keepSequence: order ? false : Boolean(src.keepSequence),
            expanded: true,
            sections: (Array.isArray(src.sections) ? src.sections : []).map(
                (name) => ({
                    key: this.nextKey("s"),
                    name: String(name ?? ""),
                }),
            ),
        };
    }

    updateFile(fileKey, updater) {
        this.files = this.files.map((f) => (f.key === fileKey ? updater(f) : f));
    }

    serialize() {
        return JSON.stringify(
            {
                pipeline: this.pipeline,
                files: this.files.map((f) => ({
                    file: f.file.trim(),
                    sections: f.sections.map((s) => s.name.trim()),
                    keepSequence: f.keepSequence,
                    order: f.order,
                })),
            },
            null,
            2,
        );
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    /* ---------------------------------------------------------------
     * Pipeline
     * ------------------------------------------------------------- */
    handlePipelineChange(event) {
        this.pipeline = event.detail.recordId || null;
        this.showPipelineError = false;
        this.isDirty = true;
    }

    /* ---------------------------------------------------------------
     * Files
     * ------------------------------------------------------------- */
    handleAddFile() {
        this.files = [...this.files, this.buildFile()];
        this.isDirty = true;
    }

    handleDeleteFile(event) {
        const { fileKey } = event.currentTarget.dataset;
        this.files = this.files.filter((f) => f.key !== fileKey);
        this.isDirty = true;
    }

    handleFileChange(event) {
        const { fileKey } = event.currentTarget.dataset;
        const value = event.detail.value;
        this.updateFile(fileKey, (f) => ({ ...f, file: value }));
        this.isDirty = true;
    }

    handleFlagChange(event) {
        const { fileKey } = event.currentTarget.dataset;
        const selected = event.detail.value;
        this.updateFile(fileKey, (f) => ({
            ...f,
            order: selected === FLAG_ORDER,
            keepSequence: selected === FLAG_KEEP_SEQUENCE,
        }));
        this.isDirty = true;
    }

    handleToggleSections(event) {
        const { fileKey } = event.currentTarget.dataset;
        this.updateFile(fileKey, (f) => ({ ...f, expanded: !f.expanded }));
    }

    /* ---------------------------------------------------------------
     * Sections
     * ------------------------------------------------------------- */
    handleAddSection(event) {
        const { fileKey } = event.currentTarget.dataset;
        this.updateFile(fileKey, (f) => ({
            ...f,
            sections: [...f.sections, { key: this.nextKey("s"), name: "" }],
        }));
        this.isDirty = true;
    }

    handleDeleteSection(event) {
        const { fileKey, sectionKey } = event.currentTarget.dataset;
        this.updateFile(fileKey, (f) => ({
            ...f,
            sections: f.sections.filter((s) => s.key !== sectionKey),
        }));
        this.isDirty = true;
    }

    handleSectionChange(event) {
        const { fileKey, sectionKey } = event.currentTarget.dataset;
        const value = event.detail.value;
        this.updateFile(fileKey, (f) => ({
            ...f,
            sections: f.sections.map((s) =>
                s.key === sectionKey ? { ...s, name: value } : s,
            ),
        }));
        this.isDirty = true;
    }

    /* ---------------------------------------------------------------
     * Save and reset
     * ------------------------------------------------------------- */
    handleReset() {
        this.showPipelineError = false;
        this.applyJson(this._savedJson);
    }

    async handleSave() {
        if (!this.effectiveRecordId) {
            this.showToast(
                "Could not save configuration",
                "No record Id available.",
                "error",
            );
            return;
        }
        // Expand files that contain blank section names so the inputs render
        // and can report their validity.
        this.files = this.files.map((f) =>
            f.sections.some((s) => !s.name.trim()) ? { ...f, expanded: true } : f,
        );
        await Promise.resolve();

        if (!this.validate()) {
            return;
        }

        const json = this.serialize();
        const previousJson = this._savedJson;
        // Set before the call so the wire refresh triggered by the save is ignored.
        this._savedJson = json;
        this.isSaving = true;
        try {
            await updateRecord({
                fields: {
                    [ID_FIELD.fieldApiName]: this.effectiveRecordId,
                    [DETAILS_FIELD.fieldApiName]: json,
                },
            });
            this.isDirty = false;
            this.parseWarning = false;
            this.showToast("Saved", "Configuration saved.", "success");
        } catch (error) {
            this._savedJson = previousJson;
            this.showToast(
                "Could not save configuration",
                errorMessage(error),
                "error",
            );
        } finally {
            this.isSaving = false;
        }
    }

    validate() {
        let valid = true;

        if (!this.pipeline) {
            this.showPipelineError = true;
            valid = false;
        }

        const inputs = this.template.querySelectorAll(
            "lightning-input[data-required]",
        );
        inputs.forEach((input) => {
            if (!input.reportValidity()) {
                valid = false;
            }
        });

        return valid;
    }
}
