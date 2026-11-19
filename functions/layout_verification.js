#!/usr/bin/env node
'use strict';

const fs = require('fs');
const child_process = require('child_process');
const path = require('path');

const TEMP_DIR = '/tmp';
const APP_DIR = '/app';
const BASE_DIR = path.join(TEMP_DIR, 'base_branch');
const FEATURE_DIR = path.join(TEMP_DIR, 'feature_branch');

// Max number of lines printed per snippet in the logs
const SNIPPET_PREVIEW_MAX_LINES = 40;

const {
    blocked_ui_sections,
    baseBranch = 'main',
    featureBranch
} = process.env;

// Disable StrictHostKeyChecking for Git SSH commands to prevent interactive prompts
process.env.GIT_SSH_COMMAND = 'ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no';

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
function log(message) {
    console.log(message);
}

function logStep(title) {
    console.log('');
    console.log(`==================== ${title} ====================`);
}

function logInfo(message, indent = 0) {
    console.log(`${' '.repeat(indent)}[INFO] ${message}`);
}

function logWarn(message, indent = 0) {
    console.log(`${' '.repeat(indent)}[WARN] ${message}`);
}

function logOk(message, indent = 0) {
    console.log(`${' '.repeat(indent)}[ OK ] ${message}`);
}

function logFail(message, indent = 0) {
    console.log(`${' '.repeat(indent)}[FAIL] ${message}`);
}

// Print a snippet (or any multi-line text) with line numbers, truncated if long
function logSnippet(label, snippet, indent = 4) {
    const pad = ' '.repeat(indent);
    if (snippet === null || snippet === undefined) {
        console.log(`${pad}${label}: <null>`);
        return;
    }
    const lines = snippet.split('\n');
    console.log(`${pad}${label}: ${snippet.length} chars, ${lines.length} lines`);
    console.log(`${pad}----- BEGIN ${label} -----`);
    lines.slice(0, SNIPPET_PREVIEW_MAX_LINES).forEach((line, i) => {
        console.log(`${pad}${String(i + 1).padStart(3, ' ')} | ${line}`);
    });
    if (lines.length > SNIPPET_PREVIEW_MAX_LINES) {
        console.log(`${pad}... (${lines.length - SNIPPET_PREVIEW_MAX_LINES} more lines truncated)`);
    }
    console.log(`${pad}----- END ${label} -----`);
}

// Helper: Execute shell commands
function executeCommand(command, cwd = process.cwd()) {
    console.log(`===> Executing: ${command} (cwd: ${cwd})`);
    try {
        const output = child_process.execSync(command, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (output && output.trim().length > 0) {
            console.log(`===> Command output:\n${output.trim()}`);
        } else {
            console.log('===> Command finished with no output');
        }
        return output;
    } catch (error) {
        console.error(`Error executing command: ${command}`);
        console.error(error.stderr || error.message);
        throw error;
    }
}

// Helper: Output message to Copado and exit
function logAndExit(message, isError = false) {
    console.log('');
    console.log(`${isError ? '[RESULT: ERROR]' : '[RESULT: SUCCESS]'} ${message}`);
    const cmd = `copado -p "${message}"`;
    try {
        child_process.execSync(cmd, { stdio: 'ignore' });
    } catch (e) {
        console.log(message); // Fallback execution output
    }
    process.exit(isError ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Parser: Parse JSON for blocked_ui_sections format
// ---------------------------------------------------------------------------
function parseBlockedSections(jsonStr) {
    const result = {};
    let parsedData = null;
    let parsedArray = [];
    let pipelineId = null;

    logInfo(`Raw blocked_ui_sections length: ${jsonStr.length} chars`);
    logInfo(`Raw blocked_ui_sections value: ${jsonStr}`);

    try {
        parsedData = JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse blocked_ui_sections as JSON:", e.message);
        throw e;
    }

    if (Array.isArray(parsedData)) {
        parsedArray = parsedData;
    } else if (parsedData && typeof parsedData === 'object') {
        parsedArray = parsedData.files || [];
        pipelineId = parsedData.pipeline || null;
    } else {
        throw new Error('blocked_ui_sections must be a JSON array or an object containing a "files" array.');
    }

    logInfo(`Pipeline ID: ${pipelineId || 'Not specified'}`);
    logInfo(`Parsed blocked_ui_sections entries: ${parsedArray.length}`);

    parsedArray.forEach((item, index) => {
        logInfo(`Entry #${index + 1}: ${JSON.stringify(item)}`);

        if (!item.file) {
            logWarn(`Entry #${index + 1} has no "file" property. Skipping.`, 2);
            return;
        }

        const filePath = item.file;
        const fileName = path.basename(filePath);
        const name = fileName.substring(0, fileName.indexOf('.')) || fileName;
        const metadataType = filePath.includes('.flexipage-meta.xml') ? 'FlexiPage' : 'Layout';

        if (result[filePath]) {
            logWarn(`Entry #${index + 1}: "${filePath}" is defined more than once. The last definition wins.`, 2);
        }

        result[filePath] = {
            sequence_important: item.keepSequence === true,
            order_important: item.order === true,
            sections: item.sections || [],
            name: name,
            metadataType: metadataType
        };

        logInfo(`Entry #${index + 1} resolved:`, 2);
        logInfo(`file              : ${filePath}`, 4);
        logInfo(`metadata name     : ${name} (${metadataType})`, 4);
        logInfo(`keepSequence      : ${result[filePath].sequence_important}`, 4);
        logInfo(`order             : ${result[filePath].order_important}`, 4);
        logInfo(`sections (${result[filePath].sections.length})   : ${JSON.stringify(result[filePath].sections)}`, 4);

        if (result[filePath].sections.length === 0) {
            logWarn(`"${filePath}" has no sections configured. Nothing will be verified for it.`, 4);
        }
    });

    return { files: result, pipeline: pipelineId };
}

// ---------------------------------------------------------------------------
// Extractor: Pull out specific Layout Sections or FlexiPage Regions using RegEx
// ---------------------------------------------------------------------------
function extractSnippet(content, metadataType, sectionName) {
    let regex;
    if (metadataType === 'Layout') {
        regex = new RegExp(`<layoutSections>(?:(?!<\\/layoutSections>)[\\s\\S])*?<label>${sectionName}<\\/label>(?:(?!<\\/layoutSections>)[\\s\\S])*?<\\/layoutSections>`, 'g');
    } else if (metadataType === 'FlexiPage') {
        regex = new RegExp(`<flexiPageRegions>(?:(?!<\\/flexiPageRegions>)[\\s\\S])*?<name>${sectionName}<\\/name>(?:(?!<\\/flexiPageRegions>)[\\s\\S])*?<\\/flexiPageRegions>`, 'g');
    } else {
        logWarn(`extractSnippet: unsupported metadata type "${metadataType}"`, 6);
        return null;
    }

    logInfo(`Regex used for "${sectionName}": ${regex}`, 6);

    const match = content.match(regex);
    if (!match) {
        logWarn(`No snippet found for section "${sectionName}"`, 6);
        return null;
    }

    logOk(`Found ${match.length} match(es) for section "${sectionName}". Using the first one.`, 6);
    return match[0];
}

// Extract a snippet and log where it was found
function extractAndLogSnippet(content, metadataType, sectionName, sourceLabel) {
    logInfo(`Looking for section "${sectionName}" in ${sourceLabel} (${metadataType})`, 4);
    const snippet = extractSnippet(content, metadataType, sectionName);
    if (snippet) {
        const idx = content.indexOf(snippet);
        const lineNumber = content.substring(0, idx).split('\n').length;
        logInfo(`Snippet for "${sectionName}" starts at char ${idx} (line ${lineNumber}) in ${sourceLabel}`, 6);
        logSnippet(`SNIPPET "${sectionName}" from ${sourceLabel}`, snippet, 6);
    }
    return snippet;
}

// ---------------------------------------------------------------------------
// Main execution block
// ---------------------------------------------------------------------------
async function run() {
    try {
        logStep('ENVIRONMENT');
        logInfo(`baseBranch      : ${baseBranch}`);
        logInfo(`featureBranch   : ${featureBranch}`);
        logInfo(`blocked_ui_sections defined: ${!!blocked_ui_sections}`);
        logInfo(`Node version    : ${process.version}`);
        logInfo(`Working dir     : ${process.cwd()}`);
        logInfo(`GIT_SSH_COMMAND : ${process.env.GIT_SSH_COMMAND}`);

        if (!blocked_ui_sections) {
            logAndExit("No blocked_ui_sections defined in properties. Exiting successfully.");
        }

        logStep('PARSING blocked_ui_sections');
        const parsedConfig = parseBlockedSections(blocked_ui_sections);
        const blockedConfig = parsedConfig.files;
        const pipelineId = parsedConfig.pipeline;
        const configuredFiles = Object.keys(blockedConfig);
        logInfo(`Total restricted metadata items configured: ${configuredFiles.length}`);
        logInfo(`Restricted metadata paths: ${JSON.stringify(configuredFiles)}`);

        // Create clean directories for branching
        logStep('CHECKING OUT BRANCHES');
        executeCommand(`mkdir -p ${BASE_DIR}`);
        executeCommand(`mkdir -p ${FEATURE_DIR}`);

        console.log(`Checking out base branch: ${baseBranch}`);
        executeCommand(`copado-git-get --depth 100 "${baseBranch}"`, BASE_DIR);

        if (!featureBranch) {
            throw new Error("featureBranch environment variable is missing.");
        }
        console.log(`Checking out feature branch: ${featureBranch}`);
        executeCommand(`copado-git-get --depth 100 "${featureBranch}"`, FEATURE_DIR);

        logStep('CALCULATING GIT DIFF');
        try {
            executeCommand(`git fetch origin ${baseBranch}`, FEATURE_DIR);
        } catch (e) {
            logWarn(`Failed to fetch ${baseBranch} normally, trying with depth 100`, 2);
            executeCommand(`git fetch origin ${baseBranch} --depth 100`, FEATURE_DIR);
        }
        
        const diffOutput = executeCommand(`git diff --name-only origin/${baseBranch}...HEAD`, FEATURE_DIR);
        // Remove empty lines and quotes around file paths that Git adds to spaced directory paths
        const changedFiles = diffOutput.split('\n').map(f => f.trim().replace(/^"|"$/g, '')).filter(f => f.length > 0);

        logInfo(`Total changed files in git diff: ${changedFiles.length}`);
        changedFiles.forEach(f => logInfo(`- ${f}`, 2));

        const relevantFiles = changedFiles.filter(f => blockedConfig[f]);
        logInfo(`Relevant restricted files changed: ${relevantFiles.length}`);
        relevantFiles.forEach(f => logInfo(`- ${f}`, 2));

        const untouched = configuredFiles.filter(f => !relevantFiles.includes(f));
        if (untouched.length > 0) {
            logInfo(`Configured restricted items NOT modified in this branch: ${JSON.stringify(untouched)}`);
        }

        if (relevantFiles.length === 0) {
            logAndExit('No restricted layouts or flexipages were modified in this branch.');
        }

        let failedFiles = [];
        let passedChecks = 0;
        let totalChecks = 0;

        // Snippet verification logic
        logStep('VERIFYING SNIPPETS');
        for (const relativePath of relevantFiles) {
            const config = blockedConfig[relativePath];
            const metadataType = config.metadataType;
            const name = config.name;

            log('');
            log(`---------- ${metadataType}: ${name} ----------`);
            logInfo(`Config: keepSequence=${config.sequence_important}, order=${config.order_important}, sections=${JSON.stringify(config.sections)}`, 2);

            const baseFile = path.join(BASE_DIR, relativePath);
            const featureFile = path.join(FEATURE_DIR, relativePath);

                logInfo(`Checking file: ${relativePath}`, 2);
                logInfo(`Base file    : ${baseFile} (exists: ${fs.existsSync(baseFile)})`, 4);
                logInfo(`Feature file : ${featureFile} (exists: ${fs.existsSync(featureFile)})`, 4);

                if (!fs.existsSync(baseFile)) {
                    console.log(`${relativePath} doesn't exist in base branch yet. Skipping restricted section check.`);
                    continue;
                }
                if (!fs.existsSync(featureFile)) {
                    logFail(`${relativePath} was deleted in the feature branch.`, 4);
                    failedFiles.push(`${name} (File deleted in feature branch)`);
                    continue;
                }

                const baseContent = fs.readFileSync(baseFile, 'utf-8');
                const featureContent = fs.readFileSync(featureFile, 'utf-8');

                logInfo(`Base content size   : ${baseContent.length} chars, ${baseContent.split('\n').length} lines`, 4);
                logInfo(`Feature content size: ${featureContent.length} chars, ${featureContent.split('\n').length} lines`, 4);
                logInfo(`Files identical     : ${baseContent === featureContent}`, 4);

                if (config.sequence_important && config.sections.length > 0) {
                    // Extract combined sequential snippet using indices
                    const firstSection = config.sections[0];
                    const lastSection = config.sections[config.sections.length - 1];
                    totalChecks++;

                    logInfo(`SEQUENCE mode. First section: "${firstSection}", last section: "${lastSection}"`, 4);

                    const firstSnippet = extractAndLogSnippet(baseContent, metadataType, firstSection, 'BASE (first section)');
                    const lastSnippet = extractAndLogSnippet(baseContent, metadataType, lastSection, 'BASE (last section)');

                    if (firstSnippet && lastSnippet) {
                        const startIdx = baseContent.indexOf(firstSnippet);
                        const endIdx = baseContent.indexOf(lastSnippet) + lastSnippet.length;
                        const combinedSnippet = baseContent.substring(startIdx, endIdx);

                        logInfo(`Combined sequence range in base: char ${startIdx} to ${endIdx}`, 4);
                        if (endIdx <= startIdx) {
                            logWarn('End index is not after start index. The sections may be in a different order in the base file than configured.', 4);
                        }
                        logSnippet('COMBINED SEQUENCE SNIPPET (base)', combinedSnippet, 4);

                        if (!featureContent.includes(combinedSnippet)) {
                            logFail(`Combined sequence NOT found unchanged in feature branch for ${name}.`, 4);
                            failedFiles.push(`${name} (Sequence modified)`);
                        } else {
                            const featureIdx = featureContent.indexOf(combinedSnippet);
                            logOk(`Combined sequence found unchanged in feature branch at char ${featureIdx}.`, 4);
                            passedChecks++;
                        }
                    } else {
                        logWarn(`Could not build the sequence snippet for ${name} (first found: ${!!firstSnippet}, last found: ${!!lastSnippet}). Check skipped.`, 4);
                    }
                } else if (config.order_important && config.sections.length > 0) {
                    // Ordered mode (loose sequence, non-contiguous allowed)
                    logInfo(`ORDER mode. Verifying loose sequence of ${config.sections.length} section(s).`, 4);
                    let previousIdx = -1;
                    let previousSectionName = null;

                    for (const section of config.sections) {
                        totalChecks++;
                        const snippet = extractAndLogSnippet(baseContent, metadataType, section, 'BASE');

                        if (!snippet) {
                            logWarn(`Section "${section}" not found in base file. Nothing to compare.`, 4);
                            continue;
                        }

                        if (!featureContent.includes(snippet)) {
                            logFail(`Section "${section}" was modified or removed in feature branch.`, 4);
                            const featureSnippet = extractSnippet(featureContent, metadataType, section);
                            if (featureSnippet) {
                                logSnippet(`SNIPPET "${section}" from FEATURE (changed)`, featureSnippet, 6);
                            } else {
                                logWarn(`Section "${section}" no longer exists in the feature branch file.`, 6);
                            }
                            failedFiles.push(`${name} (Section '${section}' modified)`);
                        } else {
                            const featureIdx = featureContent.indexOf(snippet);
                            if (featureIdx < previousIdx) {
                                logFail(`Section "${section}" appears before "${previousSectionName}" in feature branch.`, 4);
                                failedFiles.push(`${name} (Section '${section}' out of order)`);
                            } else {
                                logOk(`Section "${section}" is unchanged and in correct order (found at char ${featureIdx}).`, 4);
                                passedChecks++;
                                previousIdx = featureIdx;
                                previousSectionName = section;
                            }
                        }
                    }
                } else {
                    // Verifying sections arbitrarily (order doesn't matter)
                    logInfo(`INDEPENDENT mode. Verifying ${config.sections.length} section(s).`, 4);

                    for (const section of config.sections) {
                        totalChecks++;
                        const snippet = extractAndLogSnippet(baseContent, metadataType, section, 'BASE');

                        if (!snippet) {
                            logWarn(`Section "${section}" not found in base file. Nothing to compare.`, 4);
                            continue;
                        }

                        if (!featureContent.includes(snippet)) {
                            logFail(`Section "${section}" was modified or removed in feature branch.`, 4);
                            // Try to show what the feature branch has for the same section
                            const featureSnippet = extractSnippet(featureContent, metadataType, section);
                            if (featureSnippet) {
                                logSnippet(`SNIPPET "${section}" from FEATURE (changed)`, featureSnippet, 6);
                            } else {
                                logWarn(`Section "${section}" no longer exists in the feature branch file.`, 6);
                            }
                            failedFiles.push(`${name} (Section '${section}' modified)`);
                        } else {
                            const featureIdx = featureContent.indexOf(snippet);
                            logOk(`Section "${section}" is unchanged in feature branch (found at char ${featureIdx}).`, 4);
                            passedChecks++;
                        }
                    }
                }
            }

        logStep('SUMMARY');
        logInfo(`Restricted items verified : ${relevantFiles.length}`);
        logInfo(`Snippet checks performed  : ${totalChecks}`);
        logInfo(`Snippet checks passed     : ${passedChecks}`);
        logInfo(`Failures                  : ${failedFiles.length}`);
        if (failedFiles.length > 0) {
            failedFiles.forEach((f, i) => logFail(`#${i + 1} ${f}`, 2));
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