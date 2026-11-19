#!/usr/bin/env node
'use strict';

const fs = require('fs');
const child_process = require('child_process');
const path = require('path');

const TEMP_DIR = '/tmp';
const APP_DIR = '/app';
const BASE_DIR = path.join(TEMP_DIR, 'base_branch');
const FEATURE_DIR = path.join(TEMP_DIR, 'feature_branch');

const {
    blocked_ui_sections,
    fileChangesId,
    baseBranch = 'main',
    featureBranch
} = process.env;

// Helper: Execute shell commands
function executeCommand(command, cwd = process.cwd()) {
    console.log(`===> Executing: ${command}`);
    try {
        return child_process.execSync(command, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
        console.error(`Error executing command: ${command}`);
        console.error(error.stderr || error.message);
        throw error;
    }
}

// Helper: Output message to Copado and exit
function logAndExit(message, isError = false) {
    const cmd = `copado -p "${message}"`;
    try {
        child_process.execSync(cmd, { stdio: 'ignore' });
    } catch (e) {
        console.log(message); // Fallback execution output
    }
    process.exit(isError ? 1 : 0);
}

// Parser: Parse JSON for blocked_ui_sections format
function parseBlockedSections(jsonStr) {
    const result = {};
    let parsedArray = [];
    try {
        parsedArray = JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse blocked_ui_sections as JSON:", e.message);
        throw e;
    }
    
    for (const item of parsedArray) {
        if (!item.file) continue;
        // Extract metadata name (e.g., "Account-Account Layout" from path)
        const fileName = path.basename(item.file);
        const name = fileName.substring(0, fileName.indexOf('.'));
        if (name) {
            result[name] = {
                sequence_important: item.keepSequence === true,
                sections: item.sections || []
            };
        }
    }
    return result;
}

// Extractor: Pull out specific Layout Sections or FlexiPage Regions using RegEx
function extractSnippet(content, metadataType, sectionName) {
    let regex;
    if (metadataType === 'Layout') {
        regex = new RegExp(`<layoutSections>(?:(?!<\\/layoutSections>)[\\s\\S])*?<label>${sectionName}<\\/label>(?:(?!<\\/layoutSections>)[\\s\\S])*?<\\/layoutSections>`, 'g');
    } else if (metadataType === 'FlexiPage') {
        regex = new RegExp(`<flexiPageRegions>(?:(?!<\\/flexiPageRegions>)[\\s\\S])*?<name>${sectionName}<\\/name>(?:(?!<\\/flexiPageRegions>)[\\s\\S])*?<\\/flexiPageRegions>`, 'g');
    } else {
        return null;
    }

    const match = content.match(regex);
    return match ? match[0] : null;
}

// Main execution block
async function run() {
    try {
        if (!blocked_ui_sections) {
            logAndExit("No blocked_ui_sections defined in properties. Exiting successfully.");
        }

        const blockedConfig = parseBlockedSections(blocked_ui_sections);

        // Fetch user story encoded metadata changes file
        let changesFilePath = path.join(APP_DIR, 'encoded_changes.json');
        if (fileChangesId) {
            try {
                executeCommand(`copado --downloadfiles ${fileChangesId} --downloaddir ${TEMP_DIR}`);
            } catch(e) {
                console.log("Failed downloading fileChangesId, falling back to local files if present.");
            }
        }

        if (!fs.existsSync(changesFilePath)) {
             const files = fs.readdirSync(TEMP_DIR).filter(f => f.endsWith('.json') && f.includes(fileChangesId));
             if (files.length > 0) {
                 changesFilePath = path.join(TEMP_DIR, files[0]);
             }
        }

        if (!fs.existsSync(changesFilePath)) {
             logAndExit("Could not find encoded_changes.json. Exiting successfully as there is nothing to verify.");
        }

        const changes = JSON.parse(fs.readFileSync(changesFilePath, 'utf-8'));

        // Filter for Layouts & FlexiPages that exist in our blocked configuration YAML
        const relevantChanges = changes.filter(c => 
            (c.t === 'Layout' || c.t === 'FlexiPage') && blockedConfig[c.n]
        );

        if (relevantChanges.length === 0) {
            logAndExit('No restricted layouts or flexipages were modified in this commit.');
        }

        // Create clean directories for branching
        executeCommand(`mkdir -p ${BASE_DIR}`);
        executeCommand(`mkdir -p ${FEATURE_DIR}`);

        console.log(`Checking out base branch: ${baseBranch}`);
        executeCommand(`copado-git-get --depth 100 "${baseBranch}"`, BASE_DIR);

        if (!featureBranch) {
            throw new Error("featureBranch environment variable is missing.");
        }
        console.log(`Checking out feature branch: ${featureBranch}`);
        executeCommand(`copado-git-get --depth 100 "${featureBranch}"`, FEATURE_DIR);

        let failedFiles = [];

        // Snippet verification logic
        for (const change of relevantChanges) {
            const metadataType = change.t;
            const name = change.n;
            const config = blockedConfig[name];

            // Try to resolve the specific filePath inside the repository utilizing the JSON "j" property payload
            let filePaths = [];
            if (change.j) {
                try {
                    const addInfo = JSON.parse(change.j);
                    if (addInfo.filePath && addInfo.filePath.length > 0) filePaths = addInfo.filePath;
                } catch(e) {}
            }

            // Fallback to basic file resolution if filePath isn't exposed in standard format
            if (filePaths.length === 0) {
                const ext = metadataType === 'Layout' ? '.layout-meta.xml' : '.flexipage-meta.xml';
                const folder = metadataType === 'Layout' ? 'layouts' : 'flexipages';
                filePaths = [`force-app/main/default/${folder}/${name}${ext}`];
            }

            for (const relativePath of filePaths) {
                const baseFile = path.join(BASE_DIR, relativePath);
                const featureFile = path.join(FEATURE_DIR, relativePath);

                if (!fs.existsSync(baseFile)) {
                     console.log(`${relativePath} doesn't exist in base branch yet. Skipping restricted section check.`);
                     continue;
                }
                if (!fs.existsSync(featureFile)) {
                     failedFiles.push(`${name} (File deleted in feature branch)`);
                     continue;
                }

                const baseContent = fs.readFileSync(baseFile, 'utf-8');
                const featureContent = fs.readFileSync(featureFile, 'utf-8');

                if (config.sequence_important && config.sections.length > 0) {
                     // Extract combined sequential snippet using indices
                     const firstSnippet = extractSnippet(baseContent, metadataType, config.sections[0]);
                     const lastSnippet = extractSnippet(baseContent, metadataType, config.sections[config.sections.length - 1]);

                     if (firstSnippet && lastSnippet) {
                          const startIdx = baseContent.indexOf(firstSnippet);
                          const endIdx = baseContent.indexOf(lastSnippet) + lastSnippet.length;
                          const combinedSnippet = baseContent.substring(startIdx, endIdx);

                          if (!featureContent.includes(combinedSnippet)) {
                              failedFiles.push(`${name} (Sequence modified)`);
                          }
                     }
                } else {
                     // Verifying sections arbitrarily (order doesn't matter)
                     for (const section of config.sections) {
                          const snippet = extractSnippet(baseContent, metadataType, section);
                          if (snippet && !featureContent.includes(snippet)) {
                              failedFiles.push(`${name} (Section '${section}' modified)`);
                          }
                     }
                }
            }
        }

        if (failedFiles.length > 0) {
            logAndExit(`Validation Failed! Blocked sections modified in: ${failedFiles.join(', ')}`, true);
        } else {
            logAndExit('Validation Passed. No blocked sections were modified.');
        }

    } catch (err) {
        console.error(err);
        logAndExit(`Unexpected error executing function: ${err.message}`, true);
    }
}

run();