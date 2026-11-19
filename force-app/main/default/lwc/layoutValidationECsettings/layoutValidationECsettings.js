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
            this.applyJson(raw);
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
                cfg = JSON.parse(raw) ?? {};
            } catch (e) {
                this.parseWarning = true;
            }
        }
        this.pipeline = cfg.pipeline || null;
        const files = Array.isArray(cfg.files) ? cfg.files : [];
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
    get displayFiles() {
        return this.files.map((f, index) => ({
            ...f,
            fileLabel: `File ${index + 1}`,
            sectionsLabel: `Sections (${f.sections.length})`,
            hasNoSections: f.sections.length === 0,
            ariaExpanded: String(f.expanded),
            sectionClass: `slds-section slds-m-top_small${f.expanded ? " slds-is-open" : ""}`,
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
        return {
            key: this.nextKey("f"),
            file: src.file || "",
            keepSequence: Boolean(src.keepSequence),
            order: Boolean(src.order),
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
        const { fileKey, flag } = event.currentTarget.dataset;
        const checked = event.detail.checked;
        this.updateFile(fileKey, (f) => ({ ...f, [flag]: checked }));
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
        // Expand files that contain blank section names so the inputs render
        // and can report their validity.
        if (!this.effectiveRecordId) {
            this.showToast(
                "Could not save configuration",
                "No record Id available.",
                "error",
            );
            return;
        }
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
