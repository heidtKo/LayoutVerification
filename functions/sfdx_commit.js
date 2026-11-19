#!/usr/bin/env node
'use strict';

/**
 * Performs commit of selected user story metadata changes.
 * Returns (If ACTION success) new feature branch in user repo with all the changes and returns the commit id in the result record
 * (If ACTION failed) Returns details with error status on user story commit record
 * @param fileChangesId
 * @param fileName
 * @param sourceSessionId
 * @param sourceEndPoint
 * @param git_json
 * @param baseBranch
 * @param sourceEnv
 * @param findAndReplaceFileId
 * @param featureBranch
 * @param recreateIfExists
 * @param commitMessage
 * @param gitEmail
 * @param gitName
 * @param sourceEnvironmentBranch
 * @param maxBuffer
 * @param gitDepth
 * @param timeout
 * @param chunkSize
 * @param overriddenApiVersion
 * @param commitId
 * @param selectionsForBundledMetadata
 * @param jsonInformation
 * @param customCommitMessageSuffix
 * @param newCommitExperienceEnabled
 * @param enableFalseTagPermissions
 */

const child_process = require('child_process'),
	fs = require('fs'),
	https = require('https'),
	process = require('process'),
	{
		featureBranch,
		sourceSessionId,
		isTest,
		gitDepth,
		findAndReplaceFileId,
		sourceEnv,
		API_VERSION,
		commitId,
		vlocityFilesPath,
		chunkSize,
		disableEarlyCommitCompletion,
		sourceEndPoint,
		selectionsForBundledMetadata,
		cleanPullRequestEnabled,
		jsonInformation,
		customCommitMessageSuffix,
		CUSTOM_LABEL_RETRIEVE_PROJECT_DIRECTORY,
		CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH,
		CUSTOM_LABEL_RETRIEVE_FILE_PATH,
		newCommitExperienceEnabled,
		enableFalseTagPermissions
	} = process.env,
	preserveUserPermissionEnabled = false,
	{ Ux } = isTest ? require('@salesforce/sf-plugins-core') : require('/usr/local/lib/node_modules/@salesforce/sf-plugins-core'),
	{ Retriever, CopaReconcilerInput, Operation } = isTest
		? require('../common/__mocks__/modules/copado-metadata-reconciler')
		: require('/usr/local/lib/node_modules/@mcdx/copado-metadata-reconciler'),
	TEMP_DIRECTORY = getPath('/tmp'),
	APP_DIRECTORY = getPath('/app'),
	TARGET_DIRECTORY = `${APP_DIRECTORY}/repository`,
	COMMIT_CHANGES_FILE_PATH = `${APP_DIRECTORY}/encoded_changes.json`,
	RETRIEVE_RESULT_PATH = `${TEMP_DIRECTORY}/retrieveResult.json`,
	VAR_REPLACE_FILE_PATH = `${TEMP_DIRECTORY}/varReplace.json`,
	RETRIEVE_RESULT_PATH_CUSTOM_LABELS = `${TEMP_DIRECTORY}/retrieveResultCustomLabels.json`,
	FULL_PROFILE_RETRIEVE_RESULT_PATH = `${TEMP_DIRECTORY}/fullProfileResult.json`,
	FILES_TO_INCLUDE = `${TEMP_DIRECTORY}/filesToInclude.json`,
	FILES_TO_INCLUDE_CUSTOM_LABEL = `${TEMP_DIRECTORY}/filesToIncludeCustomLabel.json`,
	OUTPUT_JSON_FILE_PATH = `${TEMP_DIRECTORY}/output.json`,
	ACTIONS = {
		ADD: 'add',
		RETRIEVE_ONLY: 'retrieveonly',
		FULL: 'full',
		DELETE: 'delete',
		SELECTIVE_COMMIT: 'selectivecommit',
		ADD_WITH_SYSTEM_PERMISSION: 'addwithsystempermission'
	},
	TYPES = {
		PERMISSION_SET: 'permissionset',
		MUTING_PERMISSION_SET: 'mutingpermissionset',
		PROFILE: 'profile',
		CUSTOM_OBJECT: 'customobject'
	},
	USER_PERMISSION_METADATA_TYPES = [TYPES.PROFILE, TYPES.PERMISSION_SET, TYPES.MUTING_PERMISSION_SET],
	STDIO = {
		INHERIT: 'inherit',
		PIPE: 'pipe',
		IGNORE: 'ignore'
	},
	CUSTOM_LABELS = ['customlabel', 'customlabels'],
	PARENT_NESTED_METADATA = ['customlabels', 'workflow', 'sharingrules', 'escalationrules', 'matchingrules', 'autoresponserules', 'assignmentrules'],
	COPADO_YML = 'Copado',
	COMMIT_OPERATION = 'Commit Operation',
	GIT_DEPTH = getGitDepth(gitDepth),
	COPADO_INFO_PREFIX = 'CopadoFunction INFO',
	SELECTIVE_COMMIT_SUFFIX = {
		SESSION: 'session',
		COMMIT: 'commit'
	},
	PORCELAIN_STATUS = {
		ADDED: 'A',
		DELETED: 'D',
		UNMERGED: 'U'
	},
	GIT_STATUS_FILE_PATH = `${TEMP_DIRECTORY}/git_status.txt`,
	CATEGORY = {
		VLOCITY: 'vlocity',
		SFDX: 'sfdx'
	},
	COPADO_RETRIEVE_XML = 'CopadoRetrieve.xml',
	COPADO_CUSTOM_LABELS_RETRIEVE_XML = 'CopadoCustomLabelsRetrieve.xml',
	RETRIEVE_ERRORS_TO_BE_DISCARDED = ['cannot retrieve a standard tab'],
	FORCE_IGNORE = '.forceignore',
	CMCSF_SELECTIONS_FOR_BUNDLED_METADATA_SESSION = 'cmcSf_SelectionsForBundledMetadata_session',
	CMCSF_SELECTIONS_FOR_BUNDLED_METADATA_COMMIT = 'cmcSf_SelectionsForBundledMetadata_commit',
	RESULT_INFO = {
		LEVEL: {
			INFO: 'INFO',
			ERROR: 'ERROR',
			WARN: 'WARN'
		},
		CATEGORY: {
			UNKNOWN_EXCEPTION: 'Unknown Exception',
			COPADO_INFO: 'Copado Info',
			COPADO_METADATA_INTELLIGENCE: 'Copado Metadata Intelligence',
			GIT: 'Git',
			COPADO_SERVICE: 'Copado Service',
			SFDX_CLI: 'Salesforce CLI',
			FILE_SYSTEM: 'File System',
			GIT_SERVICE: 'Git Service',
			COMMIT_INFO: 'Commit Info',
			METADATA_RECONCILER: 'Metadata Reconciler',
			SELECTIVE_COMMIT: 'Selective Commit'
		},
		ADDITIONAL_INFORMATION: {
			METADATA_RETRIEVAL: 'Metadata Retrieval',
			QUICK_DEPLOYMENT: 'Quick Deployment',
			GIT_STATUS: 'Git Status',
			DELETE_FEATURE_BRANCH: 'Delete Feature Branch',
			GIT_COMMIT: 'Git Commit',
			GIT_CONFIG: 'Git Configuration',
			SFDX_CONFIG: 'SFDX Configuration',
			FULL_PROFILE_RETRIEVAL: 'Full Profile Retrieval',
			FEATURE_BRANCH_CHECKOUT: 'Feature Branch Checkout',
			ENRICHER_SERVICE: 'Enricher Service',
			METADATA_PROCESSOR: 'Metadata Processor',
			ENV_VARIABLE_REPLACEMENT: 'Environment Variable Replacement',
			GLOBAL_FIND_AND_REPLACE: 'Global Find and Replace',
			COPADO_MERGE: 'Copado Merge',
			UPLOAD_FILES: 'Upload Files',
			DOWNLOAD_FILES: 'Download Files',
			GIT_MERGE: 'Git Merge',
			GIT_PUSH: 'Git Push',
			GIT_ADD: 'Git Add',
			GIT_CLEAN: 'Git Clean',
			GIT_CLONE: 'Git Clone',
			GIT_CHECKOUT: 'Git Checkout',
			GIT_FIND_COMMIT_ID: 'Git Find Commit Id',
			GIT_LIST_UNTRACKED_FILES: 'Git List Untracked Files',
			GIT_MERGE_PUSH_FEATURE_BRANCH: 'Git Merge & Push Feature Branch',
			MISSING_DETAILS: 'Missing Details',
			COPY_FILES: 'Copy Files'
		}
	},
	resultViewerJson = [],
	CUSTOM_ERROR = {
		COMMAND_EXECUTION_ERROR: 'CommandExecutionError'
	},
	SELECTIVE_COMMIT_SUPPORTED_METADATA = ['Layout', 'FlexiPage', 'ApexClass', 'ApexTrigger'],
	BUNDLED_SELECTIVE_COMMIT_SUPPORTED_METADATA = ['LightningComponentBundle', 'AuraDefinitionBundle', 'ExperienceBundle', 'WaveTemplateBundle'],
	RESULT_TABLE_HEADER = {
		label: 'Commit Result',
		customLabel: 'Commit_Result'
	},
	HEADER_ICON = 'standard:note',
	RESULT_TABLE_COLUMNS = [
		{
			label: 'Level',
			fieldName: 'Level',
			type: 'text',
			wrapText: true,
			customLabel: 'Level',
			initialWidth: 80
		},
		{
			label: 'Category',
			fieldName: 'Category',
			type: 'text',
			wrapText: true,
			customLabel: 'Category',
			initialWidth: 120
		},
		{
			label: 'Additional Information',
			fieldName: 'AdditionalInformation',
			type: 'text',
			wrapText: true,
			customLabel: 'Additional_Information',
			initialWidth: 200
		},
		{
			label: 'Message',
			fieldName: 'Message',
			type: 'text',
			wrapText: true,
			customLabel: 'Message'
		}
	];

let commitChanges = {},
	useTargetOrgAuth = false,
	sourceApiVersion = isTest ? API_VERSION : '',
	filesInScope = [],
	totalTimeByType = {},
	processes = new Map(),
	executionError,
	hasPrefetchedVolume = false;

// SCRIPT FUNCTIONS

async function execute(commitChanges) {
	try {
		console.time(COMMIT_OPERATION);
		hasPrefetchedVolume = fs.existsSync(TARGET_DIRECTORY);
		this.logger(`hasPrefetchedVolume:  ${hasPrefetchedVolume}`);
		this.logger(`newCommitExperienceEnabled: ${newCommitExperienceEnabled}`);
		this.logger(`preserveUserPermissionEnabled: ${preserveUserPermissionEnabled}`);
		const filesToBeDiscarded = [];
		if (commitId) {
			await this.setupGitRepository();
			await this.validateCommitId(commitId);
		}
		await Promise.all(this.initialSetup(commitChanges));
		if (commitChanges?.Sfdx?.hasCustomLabelsAdded()) {
			this.updateForceIgnore();
		}

		if (fs.existsSync(vlocityFilesPath)) {
			await this.copyFiles(vlocityFilesPath, TARGET_DIRECTORY);
		}
		if (commitChanges.hasSfdxMetadata() && !commitChanges.Sfdx?.hasOnlyDestructiveChanges()) {
			await Promise.all(await this.retrieveOrgMetadata(commitChanges));
		}

		if (commitChanges?.Sfdx?.hasCustomLabelsAdded()) {
			await this.discardFilesInGit([FORCE_IGNORE]);
		}

		await this.enrichChangeList(COMMIT_CHANGES_FILE_PATH, RETRIEVE_RESULT_PATH, 'COMMIT');

		if (commitChanges.hasSfdxMetadata() && !commitChanges.Sfdx?.hasOnlyDestructiveChanges() && fs.existsSync(RETRIEVE_RESULT_PATH)) {
			this.findErrorsAndWarningsDuringRetrieval(COMMIT_CHANGES_FILE_PATH, RETRIEVE_RESULT_PATH);
		}

		//This block is needed to adapt filepaths coming from NCE without Metacache. In this case we do not have them so we need to get them always from
		//the retrieve result.
		const bundledMetadataSelectionsInit = await this.downloadAndReadSelectedFilesForBundledMetadata(selectionsForBundledMetadata);
		let retrieveResult = null;
		let parsedRetrieveResult = null;
		if (fs.existsSync(RETRIEVE_RESULT_PATH)) {
			retrieveResult = fs.readFileSync(RETRIEVE_RESULT_PATH, 'utf8');
			parsedRetrieveResult = JSON.parse(retrieveResult);
		}
		const bundledMetadataSelections = this.updateBundledMetadataSelections(bundledMetadataSelectionsInit, parsedRetrieveResult);
		// End block

		const bundledSelectiveCommitFilePaths = await this.handleSelectiveCommitOperations(TARGET_DIRECTORY, bundledMetadataSelections);
		if (bundledSelectiveCommitFilePaths?.filesInBundleToBeDiscarded.length > 0) {
			filesToBeDiscarded.push(...bundledSelectiveCommitFilePaths.filesInBundleToBeDiscarded);
			fs.writeFileSync(COMMIT_CHANGES_FILE_PATH, JSON.stringify(bundledSelectiveCommitFilePaths?.enrichedChanges, null, 2));
		}
		this.getFilesRetrievedInTargetDirectory();
		this.getFilesRetrievedForCustomLabels();

		/** Need this as we need to apply on 2 different Repository ,
		 /app/Repo & other where we retrieve custom labels temporarily - No performance impact tested and both executions took exactly same time
		 **/
		if (!commitChanges.Sfdx?.hasOnlyDestructiveChanges()) {
			const varreplace = [];
			const findAndReplace = [];
			if (fs.existsSync(FILES_TO_INCLUDE)) {
				varreplace.push(this.varReplace(sourceEnv, FILES_TO_INCLUDE));
			}
			if (fs.existsSync(FILES_TO_INCLUDE_CUSTOM_LABEL) && commitChanges?.Sfdx.hasCustomLabelsAdded()) {
				varreplace.push(this.varReplace(sourceEnv, FILES_TO_INCLUDE_CUSTOM_LABEL, CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH));
			}
			await Promise.all(varreplace);

			if (fs.existsSync(FILES_TO_INCLUDE)) {
				findAndReplace.push(this.findAndReplace(findAndReplaceFileId, featureBranch, FILES_TO_INCLUDE));
			}
			if (fs.existsSync(FILES_TO_INCLUDE_CUSTOM_LABEL) && commitChanges?.Sfdx.hasCustomLabelsAdded()) {
				findAndReplace.push(
					this.findAndReplace(findAndReplaceFileId, featureBranch, FILES_TO_INCLUDE_CUSTOM_LABEL, CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH)
				);
			}
			await Promise.all(findAndReplace);
		}

		if (commitChanges.hasSfdxMetadata()) {
			await this.processMetadata();
			this.updateFilePathsForCustomLabels();
			filesToBeDiscarded.push(...this.getRetrieveOnlyFilesToDiscard(commitChanges));
		}

		if (filesToBeDiscarded?.length) {
			await this.discardFilesInGit(filesToBeDiscarded);
		}

		const featureCommitId = await this.commitAndUpdateEnvironmentBranches(GIT_DEPTH, disableEarlyCommitCompletion);

		// Handle Clean Pull Request operations
		await this.handleCleanPullRequestOperations(featureCommitId);

		console.timeEnd(COMMIT_OPERATION);
		} catch (err) {
		this.logger(`Error stack: ${err.stack}`);
		if (!(err instanceof CommandExecutionError)) {
			this.populateResultViewer(RESULT_INFO.LEVEL.ERROR, RESULT_INFO.CATEGORY.UNKNOWN_EXCEPTION, 'See logs for more info', err.message);
		}
		executionError = err.message || err?.toString() || 'Unknown Error occurred';
	} finally {
		this.printMetrics();
		if (fs.existsSync(COMMIT_CHANGES_FILE_PATH)) {
			this.uploadFile(COMMIT_CHANGES_FILE_PATH, 'EnrichedChanges.json');
		}
		if (resultViewerJson?.length) {
			this.uploadResultViewerJson(resultViewerJson, RESULT_TABLE_COLUMNS, RESULT_TABLE_HEADER, HEADER_ICON);
		}
		if (executionError) {
			await this.executeCommand(this.getErrorCmdString(executionError));
			process.exit(1);
		}
	}
}

// SCRIPT FUNCTIONS

function encodeFileNames(committedMetadata, filePath) {
	this.validateCommittedChanges(committedMetadata);

	for (let commitChange of committedMetadata) {
		if (!commitChange.c) {
			commitChange.c = CATEGORY.SFDX;
		}
		if (commitChange.c?.toLowerCase() == CATEGORY.SFDX) {
			switch (commitChange.t) {
				/*
					This decoding logic for DashboardFolder, ReportFolder and EmailTemplate is no longer needed from DX v5.9 as US-0072554 removed the encoding for these metadata from SourceMember.cls
					but we shall keep it in place for backward compatibility
				*/
				case 'DashboardFolder':
				case 'ReportFolder':
				case 'Document':
					commitChange.n = commitChange.n.replace(/%2F/gi, '/');
					break;

				case 'EmailTemplate':
					commitChange.n = commitChange.n.replace(/%24/gi, '$').replace(/%2F/gi, '/');
					break;

				case 'Layout': {
					const regExp = '(?:([a-zA-Z_][a-zA-Z0-9_]{0,14}?(?!__c-))__)?([^-]+)-(?:([a-zA-Z_][a-zA-Z0-9_]{0,14}?_?(?!__c$))__)?(.+)\n?';
					/*
						The above regExp divides the layout full name into 4 groups:
						1. customobject namespace
						2. customobject name
						3. layout namespace
						4. layout mame
						The match function returns these groups respectively in the indices 1,2,3,4
					*/
					const layoutFullName = commitChange.n.match(regExp);
					let layoutName = layoutFullName[4].replace(/_{2}(?!c)/g, match => {
						return match.replace(/_/gi, '%5F');
					});
					layoutName = layoutName.replace(/\./, '%2E');
					commitChange.n = `${layoutFullName[1] ? layoutFullName[1] + '__' : ''}${layoutFullName[2]}-${
						layoutFullName[3] ? layoutFullName[3] + '__' : ''
					}${layoutName}`;
					break;
				}

				case 'Profile':
					commitChange.n = commitChange.n.replace(/\./gi, '%2E').replace(/__/gi, '%5F%5F');
					break;
			}
		}
	}
	fs.writeFileSync(filePath, JSON.stringify(committedMetadata, null, 2));
}

function getSFChanges(committedMetadata) {
	return committedMetadata.filter(selection => !selection.c || selection.c?.toLowerCase() == CATEGORY.SFDX);
}

function getCommitChanges(dir, commitChangesFileName, encodedChangesFileName) {
	let result;
	// If condition would only be satisfied when Encoded Changes file has been Created in Vlocity Retrieve step.
	if (fs.existsSync(encodedChangesFileName)) {
		result = this.readFromPath(encodedChangesFileName);
	} else {
		let downloadedFileName;
		if (fs.existsSync(`${dir}/${commitChangesFileName}`)) {
			downloadedFileName = commitChangesFileName;
		} else if (fs.existsSync(`${dir}/${commitChangesFileName}.json`)) {
			downloadedFileName = `${commitChangesFileName}.json`;
		} else {
			throw new Error('Error fetching Commit Changes');
		}
		result = this.readFromPath(`${dir}/${downloadedFileName}`);
		this.printChanges(result);
	}
	return result;
}

function validateCommittedChanges(committedMetadata) {
	const isValid =
		Array.isArray(committedMetadata) &&
		committedMetadata?.length &&
		committedMetadata?.filter(change => !change.n || !change.t || !change.a)?.length == 0;
	if (!isValid) {
		throw new Error('The Commit Changes do not follow the Commit Action Contract');
	}
}

function prepareMetadataChangesList(filePath, commitChanges) {
	const allChanges = this.readFromPath(filePath);
	const sfdxChanges = this.getSFChanges(allChanges);

	commitChanges.Sfdx = {
		all: sfdxChanges,
		addOrRetrieve: sfdxChanges.filter(
			selectedMetadata =>
				selectedMetadata.a.toLowerCase() == ACTIONS.RETRIEVE_ONLY ||
				selectedMetadata.a.toLowerCase() == ACTIONS.ADD ||
				selectedMetadata.a.toLowerCase() == ACTIONS.ADD_WITH_SYSTEM_PERMISSION ||
				selectedMetadata.a.toLowerCase() == ACTIONS.SELECTIVE_COMMIT ||
				(selectedMetadata.a.toLowerCase() == ACTIONS.FULL && selectedMetadata.t.toLowerCase() != TYPES.PROFILE)
		),
		delete: sfdxChanges.filter(selectedMetadata => selectedMetadata.a.toLowerCase() == ACTIONS.DELETE),
		profiles: sfdxChanges.filter(
			selectedMetadata => selectedMetadata.a.toLowerCase() == ACTIONS.FULL && selectedMetadata.t.toLowerCase() == TYPES.PROFILE
		),
		retrieveOnly: sfdxChanges.filter(selectedMetadata => selectedMetadata.a.toLowerCase() == ACTIONS.RETRIEVE_ONLY),
		customLabels: sfdxChanges.filter(
			selectedMetadata => CUSTOM_LABELS.includes(selectedMetadata.t.toLowerCase()) && selectedMetadata.a.toLowerCase() !== ACTIONS.DELETE
		),
		hasOnlyDestructiveChanges: () => {
			return commitChanges?.Sfdx.delete?.length > 0 && commitChanges?.Sfdx.delete?.length === sfdxChanges.length;
		},
		hasCustomLabelsAdded: () => {
			return commitChanges?.Sfdx.customLabels?.length > 0;
		}
	};

	commitChanges.hasSfdxMetadata = function () {
		return sfdxChanges?.length > 0 ? true : false;
	};
}

function isAddWithSystemPermissionChange(selectedMetadata) {
	return (
		selectedMetadata?.a?.toLowerCase() == ACTIONS.ADD_WITH_SYSTEM_PERMISSION &&
		USER_PERMISSION_METADATA_TYPES.includes(selectedMetadata?.t?.toLowerCase())
	);
}

function checkNestedParentMetadataDeletion(commitChanges) {
	const notToDeleteMetadataTypes = new Set();
	if (commitChanges?.Sfdx?.delete?.length) {
		commitChanges.Sfdx.delete.filter(change => {
			if (PARENT_NESTED_METADATA?.includes(change.t.toLowerCase())) {
				notToDeleteMetadataTypes.add(change.t);
			}
		});
		if (notToDeleteMetadataTypes.size) {
			throw new Error(
				`${[...notToDeleteMetadataTypes].join(
					','
				)} cannot be selected for a destructive commit. Try re-committing after removing these metadata`
			);
		}
	}
}

async function setup() {
	initializeSfdxCliAuth();
	await this.checkSFDXProjectJson(featureBranch, sourceApiVersion);
	await this.createDefaultDirectory();
	await this.configureSFDXCLI(sourceApiVersion, sourceEndPoint);
}

async function checkSFDXProjectJson(branchName, sourceApiVersion) {
	const sfdxProjectJsonPath = `${TARGET_DIRECTORY}/sfdx-project.json`;
	if (fs.existsSync(sfdxProjectJsonPath)) {
		let fileContent = this.readFromPath(sfdxProjectJsonPath);
		if (fileContent.sourceApiVersion !== sourceApiVersion) {
			const commitMessage = `Updated sourceApiVersion from ${fileContent.sourceApiVersion} to ${sourceApiVersion} in sfdx-project.json to align the commit, promote and deploy operations with the latest supported api version of Copado`;
			fileContent.sourceApiVersion = sourceApiVersion;
			fs.writeFileSync(sfdxProjectJsonPath, JSON.stringify(fileContent, null, 2));
			await this.gitCommit(commitMessage, branchName, ['sfdx-project.json']);
		}
	} else {
		throw new Error(
			`Invalid configuration in ${branchName}. sfdx-project.json is invalid or missing at project root. Copado Commit and Deploy operations are required to run from within a valid sfdx project.`
		);
	}
}

function getSfdxCliExecuteOptions(dirPath) {
	return dirPath ? { shell: true, cwd: dirPath } : undefined;
}

async function configureSFDXCLI(sourceApiVersion, sourceEndPoint, dirPath) {
	const baseUrl = this.getInstanceUrl(sourceEndPoint);
	await this.authenticateSFDXCLI(baseUrl, dirPath);

	await this.executeCommand(
		`sf config set org-api-version=${sourceApiVersion}`,
		RESULT_INFO.CATEGORY.SFDX_CLI,
		RESULT_INFO.ADDITIONAL_INFORMATION.SFDX_CONFIG,
		false,
		false,
		false,
		getSfdxCliExecuteOptions(dirPath)
	);
}

async function authenticateSFDXCLI(baseUrl, dirPath) {
	const options = getSfdxCliExecuteOptions(dirPath);

	await this.executeCommand(
		`sf config set org-instance-url=${baseUrl} || exit 1`,
		RESULT_INFO.CATEGORY.SFDX_CLI,
		RESULT_INFO.ADDITIONAL_INFORMATION.SFDX_CONFIG,
		false,
		false,
		false,
		options
	);

	const loginCommand = `SF_ACCESS_TOKEN=${sourceSessionId} sf org login access-token --instance-url ${baseUrl} --set-default --no-prompt`;

	try {
		await this.executeCommand(
			loginCommand,
			RESULT_INFO.CATEGORY.SFDX_CLI,
			RESULT_INFO.ADDITIONAL_INFORMATION.SFDX_CONFIG,
			false,
			false,
			false,
			options
		);
		useTargetOrgAuth = false;
		await this.executeCommand(
			'sf org disable tracking',
			RESULT_INFO.CATEGORY.SFDX_CLI,
			RESULT_INFO.ADDITIONAL_INFORMATION.SFDX_CONFIG,
			false,
			false,
			false,
			options
		);
		this.logger('Source tracking disabled successfully.');
	} catch (error) {
		useTargetOrgAuth = true;
		this.logger('sf org login access-token failed. Continuing with --target-org fallback auth.');
		await this.executeCommand(
			`sf org disable tracking${getTargetOrgFlag()}`,
			RESULT_INFO.CATEGORY.SFDX_CLI,
			RESULT_INFO.ADDITIONAL_INFORMATION.SFDX_CONFIG,
			false,
			false,
			false,
			options
		);
	}
}

function getTargetOrgFlag() {
	if (!useTargetOrgAuth) {
		return '';
	}
	return ` --target-org "${sourceSessionId}"`;
}

function initializeSfdxCliAuth() {
	useTargetOrgAuth = false;
}

function sfdxRetrieve(commitChanges, resolve, reject) {
	this.logger('START -Salesforce- Retrieving Metadata');
	this.asyncCopadoLogMessage('Retrieving Metadata');
	this.startWatch(RESULT_INFO.CATEGORY.SFDX_CLI, RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL, processes);
	this.buildManifest(commitChanges.Sfdx.addOrRetrieve, `${TARGET_DIRECTORY}/${COPADO_RETRIEVE_XML}`);

	const retrieve = `sf project retrieve start${this.getTargetOrgFlag()} --manifest ${TARGET_DIRECTORY}/${COPADO_RETRIEVE_XML}  --ignore-conflicts --json || true`;

	this.executeCommand(retrieve, RESULT_INFO.CATEGORY.SFDX_CLI, RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL, false, true, true).then(
		retrieveResult => {
			fs.rmSync(`${TARGET_DIRECTORY}/${COPADO_RETRIEVE_XML}`);
			fs.writeFileSync(RETRIEVE_RESULT_PATH, JSON.stringify(retrieveResult));
			this.uploadFile(RETRIEVE_RESULT_PATH);
			if (retrieveResult.status && retrieveResult.message) {
				this.populateResultViewer(
					RESULT_INFO.LEVEL.ERROR,
					RESULT_INFO.CATEGORY.SFDX_CLI,
					RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL,
					retrieveResult.message
				);
				reject(
					new CommandExecutionError(
						retrieveResult.message,
						RESULT_INFO.CATEGORY.SFDX_CLI,
						RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL
					)
				);
				return;
			} else {
				resolve();
			}
		}
	);
}

function createSfdxProjectWithDefaultRepositoryPathCustomLabels(defaultRepoPath, projectDirectory) {
	this.logger(`Creating SFDX Project for custom labels with ${projectDirectory} for repo path : ${defaultRepoPath}`);
	fs.mkdirSync(defaultRepoPath + '/' + projectDirectory, { recursive: true, force: true });
	const projectJSON = {
		packageDirectories: [
			{
				path: projectDirectory,
				default: true
			}
		],
		name: 'sfdx-project',
		namespace: '',
		sfdcLoginUrl: 'https://login.salesforce.com',
		sourceApiVersion: API_VERSION
	};
	fs.writeFileSync(`${defaultRepoPath}/sfdx-project.json`, JSON.stringify(projectJSON));
}

async function retrieveCustomLabel(commitChanges, resolve, reject) {
	this.logger('START -CUSTOM LABELS- Retrieving');
	this.asyncCopadoLogMessage('Retrieving Custom Labels');
	this.createSfdxProjectWithDefaultRepositoryPathCustomLabels(CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH, CUSTOM_LABEL_RETRIEVE_PROJECT_DIRECTORY);
	this.startWatch(RESULT_INFO.CATEGORY.SFDX_CLI, RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL, processes);
	await this.configureSFDXCLI(sourceApiVersion, sourceEndPoint, CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH);
	this.buildManifest(commitChanges.Sfdx.customLabels, `${CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH}/${COPADO_CUSTOM_LABELS_RETRIEVE_XML}`);

	const retrieve = `sf project retrieve start${this.getTargetOrgFlag()} --manifest ${CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH}/${COPADO_CUSTOM_LABELS_RETRIEVE_XML}  --ignore-conflicts --json || true`;

	const options = getSfdxCliExecuteOptions(CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH);
	this.executeCommand(
		retrieve,
		RESULT_INFO.CATEGORY.SFDX_CLI,
		RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL,
		false,
		true,
		true,
		options
	).then(retrieveResult => {
		this.handleCustomLabelRetrieveResult(retrieveResult, resolve, reject, RETRIEVE_RESULT_PATH_CUSTOM_LABELS);
	});
}

function handleCustomLabelRetrieveResult(retrieveResult, resolve, reject, retrieveResultPath) {
	fs.writeFileSync(retrieveResultPath, JSON.stringify(retrieveResult));
	this.uploadFile(retrieveResultPath);
	if (retrieveResult.status && retrieveResult.message) {
		this.populateResultViewer(
			RESULT_INFO.LEVEL.ERROR,
			RESULT_INFO.CATEGORY.SFDX_CLI,
			RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL,
			retrieveResult.message
		);
		reject(
			new CommandExecutionError(retrieveResult.message, RESULT_INFO.CATEGORY.SFDX_CLI, RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL)
		);
		return;
	}
	const failedMetadataItems = retrieveResult?.result?.files?.filter(file => file.state === 'Failed');

	if (failedMetadataItems?.length) {
		const err = failedMetadataItems.map(metadata => metadata.error).toString();
		this.populateResultViewer(RESULT_INFO.LEVEL.ERROR, RESULT_INFO.CATEGORY.SFDX_CLI, RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL, err);
		reject(new CommandExecutionError(err, RESULT_INFO.CATEGORY.SFDX_CLI, RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL));
		return;
	}
	resolve(retrieveResult);
}

async function handleSelectiveCommitOperations(fileDirectory, bundledMetadataSelections) {
	let errorMessage = '';
	this.logger('START Selective Commit');
	const filesInBundleToBeDiscarded = [];
	const enrichedChanges = this.readFromPath(COMMIT_CHANGES_FILE_PATH);
	for (let change of enrichedChanges) {
		if (change?.a?.toLowerCase() == ACTIONS.SELECTIVE_COMMIT) {
			this.asyncCopadoLogMessage(`Applying Selective Commit Changes for ${change.n}`);
			if (change.j && BUNDLED_SELECTIVE_COMMIT_SUPPORTED_METADATA.includes(change.t)) {
				const jsonAdditionalInfo = JSON.parse(change.j);
				const sessionSelections = bundledMetadataSelections?.sessionSelections;
				const commitSelections = bundledMetadataSelections?.commitSelections;
				const key = `${change.t}:${change.n}`;
				let selectedFiles = [];

				if (key in sessionSelections && sessionSelections[key].length > 0) {
					selectedFiles = sessionSelections[key];
				} else if (key in commitSelections && commitSelections[key].length > 0) {
					selectedFiles = commitSelections[key];
				}

				if (selectedFiles.length) {
					filesInBundleToBeDiscarded.push(...this.getFilesToBeDiscardedFromBundle(jsonAdditionalInfo, selectedFiles));
					change.j = this.updateFilePathsInEnrichedFile(jsonAdditionalInfo, selectedFiles);
				} else {
					errorMessage = `No files selected for bundled metadata ${change.t}:${change.n} for Selective Commit.`;
				}
			} else if (change.j) {
				try {
					const changeJson = JSON.parse(change.j);
					if (changeJson?.selectiveCommitFileId && changeJson?.selectiveCommitHash) {
						await this.executeCommand(
							this.downloadFile(changeJson.selectiveCommitFileId, `${TEMP_DIRECTORY}/`),
							RESULT_INFO.CATEGORY.COPADO_SERVICE,
							RESULT_INFO.ADDITIONAL_INFORMATION.DOWNLOAD_FILES,
							true
						);

						if (changeJson?.filePath?.length && fs.existsSync(`${fileDirectory}/${changeJson.filePath[0]}`)) {
							const selectiveCommitFilePath = this.getSelectiveCommitFile(`${change.t}:${change.n}`, changeJson.selectiveCommitHash);
							const selectiveCommitContent = fs.readFileSync(selectiveCommitFilePath, 'utf-8');
							const metadataFilePath = `${fileDirectory}/${changeJson.filePath[0]}`;
							this.applySelectiveCommitContentPreservingFullName(metadataFilePath, selectiveCommitContent);
							this.uploadSelectiveCommitFileOnResult(selectiveCommitFilePath, changeJson.selectiveCommitHash);
							this.populateResultViewer(
								RESULT_INFO.LEVEL.INFO,
								RESULT_INFO.CATEGORY.SELECTIVE_COMMIT,
								'',
								`Applied Selective Commit changes for ${change.t}:${change.n} on feature branch.`
							);
						}
					}
				} catch (error) {
					logger(`Selective Commit Issue: ${error}`);
					errorMessage = `Selected metadata ${change.t}:${change.n} has a support error with Selective Commit: ${error.message}`;
				}
			}

			if (errorMessage) {
				this.populateResultViewer(
					RESULT_INFO.LEVEL.ERROR,
					RESULT_INFO.CATEGORY.SELECTIVE_COMMIT,
					RESULT_INFO.ADDITIONAL_INFORMATION.MISSING_DETAILS,
					errorMessage
				);
				throw new CommandExecutionError(errorMessage);
			}
		}
	}

	this.logger('END Selective Commit');
	return { enrichedChanges, filesInBundleToBeDiscarded };
}

function getFilesToBeDiscardedFromBundle(jsonAdditionalInfo, selectedFiles) {
	const filesNotSelected = jsonAdditionalInfo?.filePath ? jsonAdditionalInfo?.filePath.filter(path => !selectedFiles.includes(path)) : [];
	const deletedFiles = jsonAdditionalInfo?.deleteFilesFromGit
		? jsonAdditionalInfo?.deleteFilesFromGit.filter(path => !selectedFiles.includes(path))
		: [];
	return [...filesNotSelected, ...deletedFiles];
}

function updateFilePathsInEnrichedFile(jsonAdditionalInfo, selectedFiles) {
	jsonAdditionalInfo.filePath = selectedFiles;
	return JSON.stringify(jsonAdditionalInfo);
}

async function downloadAndReadSelectedFilesForBundledMetadata(selectionsForBundledMetadata) {
	let result = { sessionSelections: {}, commitSelections: {} };
	const promises = [];
	if (selectionsForBundledMetadata !== null && selectionsForBundledMetadata !== '') {
		const sessionAndCommitFileIds = selectionsForBundledMetadata.split(';');
		sessionAndCommitFileIds.forEach(fileId => {
			promises.push(
				this.executeCommand(
					this.downloadFile(fileId, `${TEMP_DIRECTORY}/`),
					RESULT_INFO.CATEGORY.COPADO_SERVICE,
					RESULT_INFO.ADDITIONAL_INFORMATION.DOWNLOAD_FILES,
					true
				)
			);
		});

		await Promise.all(promises);

		if (fs.existsSync(`${TEMP_DIRECTORY}/${CMCSF_SELECTIONS_FOR_BUNDLED_METADATA_SESSION}`)) {
			result['sessionSelections'] = JSON.parse(fs.readFileSync(`${TEMP_DIRECTORY}/${CMCSF_SELECTIONS_FOR_BUNDLED_METADATA_SESSION}`, 'utf-8'));
		}
		if (fs.existsSync(`${TEMP_DIRECTORY}/${CMCSF_SELECTIONS_FOR_BUNDLED_METADATA_COMMIT}`)) {
			result['commitSelections'] = JSON.parse(fs.readFileSync(`${TEMP_DIRECTORY}/${CMCSF_SELECTIONS_FOR_BUNDLED_METADATA_COMMIT}`, 'utf-8'));
		}
	}
	return result;
}

function retrieveFullProfile(commitChanges, resolve, reject) {
	this.logger('START -Salesforce- Retrieving Full Profile');
	this.asyncCopadoLogMessage('START -Salesforce- Retrieving Full Profile');

	this.startWatch(RESULT_INFO.CATEGORY.METADATA_RECONCILER, RESULT_INFO.ADDITIONAL_INFORMATION.FULL_PROFILE_RETRIEVAL, processes);

	const profiles = commitChanges.Sfdx.profiles.map(profile => profile.n);
	const request = this.getMetadataReconcilerRequest(profiles, Operation.FULL_PROFILE);

	new Retriever()
		.run(request)
		?.then(() => {
			this.endWatch(RESULT_INFO.ADDITIONAL_INFORMATION.FULL_PROFILE_RETRIEVAL, processes);

			const profileResult = JSON.parse(fs.readFileSync(OUTPUT_JSON_FILE_PATH, 'utf-8'));
			fs.writeFileSync(FULL_PROFILE_RETRIEVE_RESULT_PATH, JSON.stringify(profileResult));
			this.uploadFile(FULL_PROFILE_RETRIEVE_RESULT_PATH);

			const skippedProfiles = profileResult?.filter(profile => profile?.state === 'Skipped')?.map(profile => profile?.fullName);
			if (skippedProfiles?.length > 0) {
				const errorMessage = `The profiles ${skippedProfiles?.join(',')} were skipped during retrieval.`;
				this.populateResultViewer(
					RESULT_INFO.LEVEL.ERROR,
					RESULT_INFO.CATEGORY.SF_POWER_KIT,
					RESULT_INFO.ADDITIONAL_INFORMATION.SF_POWERKIT_FULL_PROFILE,
					errorMessage
				);
				reject(
					new CommandExecutionError(
						errorMessage,
						RESULT_INFO.CATEGORY.SF_POWER_KIT,
						RESULT_INFO.ADDITIONAL_INFORMATION.SF_POWERKIT_FULL_PROFILE
					)
				);
			} else {
				this.logger(profileResult);
				this.updateCommitChangeFileWithProfilePaths(profileResult);
				fs.rmSync('sfpowerkit-cache.db', {
					force: true
				});
				resolve();
			}
		})
		.catch(error => {
			const errorMessage = error.message || error?.toString() || 'Unknown Error occurred';
			this.populateResultViewer(
				RESULT_INFO.LEVEL.ERROR,
				RESULT_INFO.CATEGORY.SF_POWER_KIT,
				RESULT_INFO.ADDITIONAL_INFORMATION.SF_POWERKIT_FULL_PROFILE,
				errorMessage
			);
			reject(
				new CommandExecutionError(
					errorMessage,
					RESULT_INFO.CATEGORY.SF_POWER_KIT,
					RESULT_INFO.ADDITIONAL_INFORMATION.SF_POWERKIT_FULL_PROFILE
				)
			);
		});
}

function updateCommitChangeFileWithProfilePaths(profileResult) {
	let changes = this.readFromPath(COMMIT_CHANGES_FILE_PATH);
	changes.forEach(change => {
		if (change.a.toLowerCase() == ACTIONS.FULL && change.t?.toLowerCase() == TYPES.PROFILE) {
			const matchedProfile = profileResult?.find(profile => profile.fullName == change.n && profile.state !== 'Skipped');
			if (matchedProfile) {
				change.j = JSON.stringify({
					filePath: [matchedProfile.path]
				});
				filesInScope.push(matchedProfile.path);
			}
		}
	});
	fs.writeFileSync(COMMIT_CHANGES_FILE_PATH, JSON.stringify(changes));
}
async function retrieveOrgMetadata(commitChanges) {
	await this.setup();
	const promises = [];
	commitChanges?.Sfdx.profiles?.length &&
		promises.push(
			new Promise((resolve, reject) => {
				this.retrieveFullProfile(commitChanges, resolve, reject);
			})
		);
	commitChanges?.Sfdx.addOrRetrieve?.length &&
		promises.push(
			new Promise((resolve, reject) => {
				this.sfdxRetrieve(commitChanges, resolve, reject);
			})
		);
	commitChanges?.Sfdx.customLabels?.length &&
		promises.push(
			new Promise((resolve, reject) => {
				this.retrieveCustomLabel(commitChanges, resolve, reject);
			})
		);

	return promises;
}

function varReplace(sourceEnv, filesToInclude, repositoryDirectory) {
	if (sourceEnv && JSON.parse(sourceEnv)?.length) {
		fs.writeFileSync(VAR_REPLACE_FILE_PATH, sourceEnv);
		const targetRepositoryDirectory = repositoryDirectory ? repositoryDirectory : TARGET_DIRECTORY; // To apply on temporary directory for custom labels
		const varreplaceCommand = `varreplace '${VAR_REPLACE_FILE_PATH}' '${targetRepositoryDirectory}' ${
			filesToInclude ? '--valuename=true --include=' + `${filesToInclude}` : ''
		} || exit 1`;
		this.asyncCopadoLogMessage('Replacing environment variables, if any');
		return this.executeCommand(
			varreplaceCommand,
			RESULT_INFO.CATEGORY.COPADO_METADATA_INTELLIGENCE,
			RESULT_INFO.ADDITIONAL_INFORMATION.ENV_VARIABLE_REPLACEMENT
		);
	} else {
		return Promise.resolve();
	}
}

function getFilesFromRetrieveResult(retrieveResultFilePath, repositoryPath) {
	const result = [];
	if (fs.existsSync(retrieveResultFilePath)) {
		const retrieveResult = this.readFromPath(retrieveResultFilePath);
		retrieveResult?.result?.files?.forEach(file => {
			if (file.filePath) {
				result.push(file.filePath.substring(repositoryPath.length + 1));
			}
		});
	}
	return result;
}

function getFilesRetrievedInTargetDirectory() {
	this.logger('START Get files retrieved in Target Directory');
	filesInScope.push(...this.getFilesFromRetrieveResult(RETRIEVE_RESULT_PATH, TARGET_DIRECTORY));
	filesInScope.push(...this.getFilePaths(COMMIT_CHANGES_FILE_PATH, [ACTIONS.ADD, ACTIONS.SELECTIVE_COMMIT], [CATEGORY.VLOCITY]));

	if (filesInScope?.length) {
		fs.writeFileSync(FILES_TO_INCLUDE, JSON.stringify(filesInScope));
	}
	this.logger('END Get files retrieved in Target Directory');
}

function getFilesRetrievedForCustomLabels() {
	const result = [];
	result.push(...this.getFilesFromRetrieveResult(RETRIEVE_RESULT_PATH_CUSTOM_LABELS, CUSTOM_LABEL_RETRIEVE_REPOSITORY_PATH));
	if (result?.length) {
		fs.writeFileSync(FILES_TO_INCLUDE_CUSTOM_LABEL, JSON.stringify(result));
	}
}

function createTargetDirectoryAndFetchBaseBranch(baseBranch, gitDepth) {
	this.logger('START Creating target directory and fetching base branch');
	if (!baseBranch) {
		throw new Error('No base branch provided');
	}
	return `
    mkdir -p ${TARGET_DIRECTORY}
    cd ${TARGET_DIRECTORY}
    copado-git-get --depth "${gitDepth}" "${baseBranch}"
	${hasPrefetchedVolume ? 'copado-git-get -g "git pull origin ' + baseBranch + ' --depth ' + gitDepth + '"' : ''}`;
}

function initialSetup(commitChanges) {
	this.logger('START Initial setup');
	const promises = [];
	const { gitEmail, gitName, recreateIfExists, fileChangesId, overriddenApiVersion, API_VERSION, fileName, baseBranch } = process.env;
	promises.push(
		this.executeCommand(
			this.createTargetDirectoryAndFetchBaseBranch(baseBranch, GIT_DEPTH),
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.GIT_CLONE
		).then(async () => {
			try {
				this.logger('END Creating target directory and fetching base branch');
				this.changeWorkingDirectory(TARGET_DIRECTORY);
				await this.configureGit(gitEmail, gitName);
				await this.fetchCreateFeatureBranch(recreateIfExists, featureBranch, GIT_DEPTH);
			} catch (err) {
				throw new Error(err);
			}
		})
	);
	promises.push(
		this.executeCommand(
			this.downloadFile(fileChangesId, TEMP_DIRECTORY),
			RESULT_INFO.CATEGORY.COPADO_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.DOWNLOAD_FILES
		).then(async () => {
			try {
				sourceApiVersion = await this.getApiVersion(overriddenApiVersion, API_VERSION);
				const committedMetadata = this.getCommitChanges(TEMP_DIRECTORY, fileName, COMMIT_CHANGES_FILE_PATH);
				this.encodeFileNames(committedMetadata, COMMIT_CHANGES_FILE_PATH);
				this.prepareMetadataChangesList(COMMIT_CHANGES_FILE_PATH, commitChanges);
				this.checkNestedParentMetadataDeletion(commitChanges);
			} catch (err) {
				throw new Error(err);
			}
		})
	);

	this.logger('END Initial setup');
	return promises;
}

async function setupGitRepository() {
	const { gitEmail, gitName, recreateIfExists, baseBranch } = process.env;
	await this.executeCommand(
		this.createTargetDirectoryAndFetchBaseBranch(baseBranch, GIT_DEPTH),
		RESULT_INFO.CATEGORY.GIT_SERVICE,
		RESULT_INFO.ADDITIONAL_INFORMATION.GIT_CLONE
	);
	this.changeWorkingDirectory(TARGET_DIRECTORY);
	await this.configureGit(gitEmail, gitName);
	await this.fetchCreateFeatureBranch(recreateIfExists, featureBranch, GIT_DEPTH);
}

function changeWorkingDirectory(dir) {
	process.chdir(dir);
}

async function fetchCreateFeatureBranch(recreateIfExists, featureBranch, gitDepth) {
	this.logger('START fetch Create Feature Branch');
	if (featureBranch) {
		if (recreateIfExists == 'true') {
			this.asyncCopadoLogMessage(`Removing branch ${featureBranch}`);
			const deleteLocalAndRemoteBranch = `
            git branch -D "${featureBranch}" || true
            copado-git-get -g "git push origin --delete ${featureBranch}" || true`;
			await this.executeCommand(
				deleteLocalAndRemoteBranch,
				RESULT_INFO.CATEGORY.GIT_SERVICE,
				RESULT_INFO.ADDITIONAL_INFORMATION.DELETE_FEATURE_BRANCH,
				true
			);
		}
		this.asyncCopadoLogMessage(`Fetching/creating branch ${featureBranch}`);
		await this.executeCommand(
			this.fetchCheckoutBranch(featureBranch, gitDepth, true),
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.FEATURE_BRANCH_CHECKOUT,
			true
		);
	} else {
		throw new Error('No feature branch provided');
	}
	this.logger('END fetch Create Feature Branch');
}

function findAndReplace(findAndReplaceFileId, featureBranch, filesInScope, scopeFolder) {
	const PATH_TO_YAML = `${TEMP_DIRECTORY}/${COPADO_YML}`;
	if (findAndReplaceFileId) {
		this.asyncCopadoLogMessage('Applying global find and replace rules');
		const findAndReplace = `
		${this.downloadFile(findAndReplaceFileId, `${TEMP_DIRECTORY}/`, COPADO_YML)} || exit 1
		yamlreplace "${PATH_TO_YAML}" "${scopeFolder ? scopeFolder : TARGET_DIRECTORY}" -b "${featureBranch}" ${
			filesInScope ? ' --include=' + `${filesInScope}` : ''
		}`;

		return this.executeCommand(
			findAndReplace,
			RESULT_INFO.CATEGORY.COPADO_METADATA_INTELLIGENCE,
			RESULT_INFO.ADDITIONAL_INFORMATION.GLOBAL_FIND_AND_REPLACE
		);
	} else {
		return Promise.resolve();
	}
}

function getEnrichServiceCommand(filePath, retrieveResultPath, operationType) {
	return `enricher -p ${filePath} --repo ${TARGET_DIRECTORY}/ ${
		retrieveResultPath && fs.existsSync(retrieveResultPath) ? `--cliresponse ${retrieveResultPath}` : '--quick true'
	} ${operationType ? `--operation ${operationType}` : ''} '--handleLabels' --enrichmentMethod v3`;
}

async function enrichChangeList(filePath, retrieveResultPath, operationType) {
	this.logger('START Enricher');
	await this.executeCommand(
		this.getEnrichServiceCommand(filePath, retrieveResultPath, operationType),
		RESULT_INFO.CATEGORY.COPADO_METADATA_INTELLIGENCE,
		RESULT_INFO.ADDITIONAL_INFORMATION.ENRICHER_SERVICE
	);
	this.logger('END Enricher');
}

async function processMetadata() {
	this.logger('START Metadata Processor');
	this.asyncCopadoLogMessage('Processing metadata');
	const processsMetadata = `metadata-processor "${COMMIT_CHANGES_FILE_PATH}" "${TARGET_DIRECTORY}" -o COMMIT --handleLabels ${this.getPreserveUserPermissionsParameter()} ${this.getEnableFalseTagPermissionsParameter()}`;
	await this.executeCommand(
		processsMetadata,
		RESULT_INFO.CATEGORY.COPADO_METADATA_INTELLIGENCE,
		RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_PROCESSOR
	);
	this.logger('END Metadata Processor');
}

function getPreserveUserPermissionsParameter() {
	if (this.isNewCommitExperienceEnabled()) {
		return `--preserveUserPermissions ${preserveUserPermissionEnabled}`;
	}
	return '';
}

// Missing or empty pipeline property is false. A configured value is true only when it is "true".
function isEnableFalseTagPermissionsEnabled(value = enableFalseTagPermissions) {
	if (value == null || value === '') {
		return false;
	}
	return value.toLowerCase() === 'true';
}

function getEnableFalseTagPermissionsParameter(value = enableFalseTagPermissions) {
	return `--enableFalseTagInProfileAndPermissionSet ${this.isEnableFalseTagPermissionsEnabled(value)}`;
}

function isNewCommitExperienceEnabled() {
	return newCommitExperienceEnabled?.toLowerCase() !== 'false';
}

async function gitCommit(commitMessage, branchName, filePaths, allowCommitWithNoChanges) {
	commitMessage = this.appendCustomSuffixToCommitMessage(commitMessage);
	let gitCommit = '';
	this.asyncCopadoLogMessage(`Committing ${commitMessage} in ${branchName}`);
	if (filePaths?.length) {
		// If filePaths have path to a folder as well as paths to files inside it , it causes failure during staging as the folder could be deleted first & no files would be left inside folder in next iteration ,
		// To avoid any kind of failure during the commit process we introduce a fallback mechanism -If there is an issue in adding files to git using filepaths we simply do 'git add .' and continue with our process
		try {
			await this.executeCommandinChunks(filePaths, chunkSize, 'git add REPLACE_VALUE', {
				category: RESULT_INFO.CATEGORY.GIT_SERVICE,
				additionalInfo: RESULT_INFO.ADDITIONAL_INFORMATION.GIT_ADD
			});
		} catch (error) {
			this.logger('Re-trying staging using Git add . as chunking failed : ' + error);
			gitCommit = 'git add . || exit 1';
		}
	} else {
		gitCommit = 'git add . || exit 1';
	}
	gitCommit = `
		${gitCommit}
		git commit -m "${commitMessage}" ${allowCommitWithNoChanges ? '|| true' : ''}`;
	await this.executeCommand(gitCommit, RESULT_INFO.CATEGORY.GIT_SERVICE, RESULT_INFO.ADDITIONAL_INFORMATION.GIT_COMMIT, true);
}

async function configureGit(gitEmail, gitName) {
	const configureGit = `
        git config feature.manyFiles true || exit 1
        git update-index --index-version 4 || exit 1
        git config --local user.email "${gitEmail}" || exit 1
        git config --local user.name "${gitName}" || exit 1
        git config --global diff.renames false || exit 1
        git config --global merge.renames false || exit 1
        git config --global status.renames false || exit 1
        git config --global core.quotePath false
        `;

	await this.executeCommand(configureGit, RESULT_INFO.CATEGORY.GIT_SERVICE, RESULT_INFO.ADDITIONAL_INFORMATION.GIT_CONFIG, true);
}

// Returns true when git status has at least one non-SF CLI config change.
// This allows ".sf/" and ".sfdx/" noise to be ignored while still committing real metadata changes.
function hasRelevantGitChanges(gitStatus) {
	if (!gitStatus?.trim()) {
		return false;
	}
	const IGNORED_PREFIXES = ['.sf/', '.sfdx/'];
	const isIgnoredPath = path => IGNORED_PREFIXES.some(prefix => path.startsWith(prefix));
	const parseStatusPath = line => line.trim().replace(/^[A-Z?]{1,2}\s+/, '');

	return gitStatus
		.split('\n')
		.filter(Boolean)
		.map(parseStatusPath)
		.some(path => !isIgnoredPath(path));
}

async function commitAndUpdateEnvironmentBranches(gitDepth, disableEarlyCommitCompletion) {
	this.startWatch(RESULT_INFO.CATEGORY.GIT_SERVICE, RESULT_INFO.ADDITIONAL_INFORMATION.GIT_MERGE_PUSH_FEATURE_BRANCH, processes);
	const resultData = {};
	const { commitMessage, sourceEnvironmentBranch } = process.env,
		gitStatus = await this.executeCommand(
			'git status --porcelain',
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.GIT_STATUS,
			true
		);

	if (!this.hasRelevantGitChanges(gitStatus)) {
		resultData.status = 'No Changes';
		this.populateResultViewer(RESULT_INFO.LEVEL.INFO, RESULT_INFO.CATEGORY.COMMIT_INFO, '', 'No Changes');
		await this.executeCommand(
			`copado -p "There are no changes to be committed" -r '${JSON.stringify(resultData)}'`,
			RESULT_INFO.CATEGORY.COPADO_SERVICE,
			true
		);
		if (resultViewerJson?.length) {
			this.uploadResultViewerJson(resultViewerJson, RESULT_TABLE_COLUMNS, RESULT_TABLE_HEADER, HEADER_ICON);
		}
		this.endWatch(RESULT_INFO.ADDITIONAL_INFORMATION.GIT_MERGE_PUSH_FEATURE_BRANCH, processes);
		process.exit(0);
	} else {
		this.logger('START Commit and Push feature branch');
		const filesToStage = this.getFilePaths(COMMIT_CHANGES_FILE_PATH, [
			ACTIONS.ADD,
			ACTIONS.FULL,
			ACTIONS.DELETE,
			ACTIONS.SELECTIVE_COMMIT,
			ACTIONS.ADD_WITH_SYSTEM_PERMISSION
		]);

		await this.gitCommit(commitMessage, featureBranch, filesToStage, false);
		await this.gitPush(featureBranch);
		this.logger('END Commit and Push feature branch');

		resultData.commitId = await this.getCommitId();
		disableEarlyCommitCompletion?.toLowerCase() === 'true'
			? await this.updateResultWithCommitDetails(resultData)
			: await this.finishCommit(true, true, 'Commit Completed, Environment branches will be merged in the background', resultData);
		await this.executeAfterCommitOperations(sourceEnvironmentBranch, featureBranch, gitDepth, 0);

		// Return the feature branch commit ID for clean PR operations
		return resultData.commitId;
	}
}

function finishCommit(isFinished, isSuccess, progressStatus, resultData) {
	this.logger('START Early Finish Commit');
	return new Promise(resolve => {
		const CF_SF_SESSIONID = process.env.CF_SF_SESSIONID;
		const CF_SF_ENDPOINT = process.env.CF_SF_ENDPOINT.replace('https://', '');

		const body = JSON.stringify({
			result_id: process.env.CF_RESULTID,
			is_finished: isFinished,
			is_success: isSuccess,
			status: progressStatus,
			result_data: JSON.stringify(resultData)
		});

		const options = {
			hostname: CF_SF_ENDPOINT,
			path: '/services/apexrest/copado/FunctionWebEvent',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'Content-Length': Buffer.byteLength(body),
				Authorization: `Bearer ${CF_SF_SESSIONID}`
			}
		};

		const req = https.request(options, res => {
			res.on('data', () => {
				// on 'data' listener is mandatory to be added.
			});
			res.on('end', async () => {
				this.logger(`Status Code: ${res.statusCode}`);
				if (res.statusCode == 200) {
					this.logger('END Early Finish Commit');
					resolve(body);
				} else {
					await this.updateResultWithCommitDetails(resultData);
					this.logger('END Early Finish Commit');
					resolve(body);
				}
			});
		});

		req.on('error', async error => {
			await this.updateResultWithCommitDetails(resultData);
			this.logger(`error: ${error}`);
			this.logger('END Early Finish Commit');
			resolve(body);
		});

		req.write(body);
		req.end();
	});
}

async function executeAfterCommitOperations(sourceEnvironmentBranch, featureBranch, gitDepth, numberOfRetries) {
	this.logger('START Merge feature branch in source environment branch');
	try {
		await this.executeCommand(
			`
        git reset --hard || true
        git clean -fd || true`,
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.GIT_CLEAN,
			true
		);
		await this.executeCommand(
			this.fetchCheckoutBranch(sourceEnvironmentBranch, gitDepth, false),
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.GIT_CHECKOUT,
			true
		);
		await this.mergeFeatureBranchInSource(featureBranch, sourceEnvironmentBranch);
		await this.checkSFDXProjectJson(sourceEnvironmentBranch, sourceApiVersion);
		await this.gitPush(sourceEnvironmentBranch);
		this.endWatch(RESULT_INFO.ADDITIONAL_INFORMATION.GIT_MERGE_PUSH_FEATURE_BRANCH, processes);
	} catch (error) {
		if (numberOfRetries < 1) {
			await this.executeAfterCommitOperations(sourceEnvironmentBranch, featureBranch, gitDepth, numberOfRetries + 1);
		} else {
			await this.executeCommand(this.getErrorCmdString(error.message));
		}
	}

	this.logger('END Merge feature branch in source environment branch');
}

async function mergeFeatureBranchInSource(featureBranch, sourceEnvironmentBranch) {
	if (!sourceEnvironmentBranch) {
		throw new Error('No source environment branch provided');
	}

	try {
		const mergeCommitMessage = this.appendCustomSuffixToCommitMessage(`Merge branch ${featureBranch} into ${sourceEnvironmentBranch}`);
		const mergeFeatureBranchInSource = `git merge "${featureBranch}" -Xignore-space-change -m "${mergeCommitMessage}"`;
		this.endWatch(RESULT_INFO.ADDITIONAL_INFORMATION.GIT_MERGE_PUSH_FEATURE_BRANCH, processes);
		await this.executeCommand(mergeFeatureBranchInSource, RESULT_INFO.CATEGORY.GIT_SERVICE, RESULT_INFO.ADDITIONAL_INFORMATION.GIT_MERGE, true);
	} catch (error) {
		const gitStatus = await this.executeCommand(
			'git status --porcelain=v1',
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.GIT_STATUS,
			true
		);
		// Logging git status for debugging
		this.logger(gitStatus);
		fs.writeFileSync(GIT_STATUS_FILE_PATH, gitStatus);
		if (this.hasConflict()) {
			fs.writeFileSync(OUTPUT_JSON_FILE_PATH, '');
			this.asyncCopadoLogMessage('Resolving git conflicts');
			await this.executeCommand(
				`copado-merge ${TARGET_DIRECTORY} ${COMMIT_CHANGES_FILE_PATH} -p ${GIT_STATUS_FILE_PATH} -t sfdx -c --out ${TEMP_DIRECTORY}/ ${this.getPreserveUserPermissionsParameter()}`,
				RESULT_INFO.CATEGORY.COPADO_METADATA_INTELLIGENCE,
				RESULT_INFO.ADDITIONAL_INFORMATION.COPADO_MERGE
			);
		} else {
			throw new Error(error);
		}
	}

	await this.gitCommit(
		`Merging ${featureBranch} into ${sourceEnvironmentBranch} after auto conflict resolution`,
		sourceEnvironmentBranch,
		undefined,
		true
	);
}

function hasConflict() {
	let hasConflict = false;
	const gitStatus = fs.readFileSync(GIT_STATUS_FILE_PATH, 'utf-8');
	if (gitStatus) {
		const porcelainStatus = gitStatus.split('\n').map(str => str.split(' ')?.[0]);
		hasConflict = porcelainStatus.some(status => {
			if (
				(status[0] && status[1] && status[0] === PORCELAIN_STATUS.ADDED && status[1] === PORCELAIN_STATUS.ADDED) ||
				(status[0] === PORCELAIN_STATUS.DELETED && status[1] === PORCELAIN_STATUS.DELETED)
			) {
				return true;
			}
			return status[0] === PORCELAIN_STATUS.UNMERGED || status[1] === PORCELAIN_STATUS.UNMERGED;
		});
	}
	return hasConflict;
}

async function getCommitId() {
	return await this.executeCommand(
		'git rev-parse HEAD',
		RESULT_INFO.CATEGORY.GIT_SERVICE,
		RESULT_INFO.ADDITIONAL_INFORMATION.GIT_FIND_COMMIT_ID,
		true
	);
}

async function gitPush(branchName) {
	this.asyncCopadoLogMessage(`Pushing all changes to ${branchName}`);
	const gitPush = `copado-git-get -g "git push origin ${branchName}"`;
	await this.executeCommand(gitPush, RESULT_INFO.CATEGORY.GIT_SERVICE, RESULT_INFO.ADDITIONAL_INFORMATION.GIT_PUSH, true);
}

function getErrorCmdString(error) {
	const suffix = 'Please check the logs for details.';
	return `copado -p "Error" -e ${JSON.stringify(error?.trim()?.substring(0, 32760) + '; ' + suffix)}`;
}

function readFromPath(filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`Could not find file at path: ${filePath}`);
	}
	const data = fs.readFileSync(filePath, 'utf-8');
	let result;
	try {
		result = JSON.parse(data);
	} catch (err) {
		throw new Error(`Content at ${filePath} is not a valid JSON`);
	}
	return result;
}

function getFilePaths(changeFilePath, actions, categories) {
	let changeList = this.readFromPath(changeFilePath);
	let filePaths = new Set();
	if (actions?.length || categories?.length) {
		changeList = changeList.filter(change => {
			let isValid = true;
			if (actions?.length) {
				isValid = isValid && actions.includes(change.a.toLowerCase());
			}
			if (categories?.length) {
				isValid = isValid && categories?.includes(change.c.toLowerCase());
			}
			return isValid;
		});
	}
	changeList.forEach(change => {
		if (change.j && change.j !== '') {
			const jsonAdditionalInfo = JSON.parse(change.j);
			let filesToBeAdded = jsonAdditionalInfo?.filePath?.filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
			const deletedFiles = jsonAdditionalInfo?.deleteFilesFromGit;
			if (deletedFiles?.length) {
				this.logger(`Deleted files to be staged : ${deletedFiles}`);
				filesToBeAdded.push(...deletedFiles);
			}

			if (change.t.toLowerCase() == TYPES.CUSTOM_OBJECT && change.a.toLowerCase() == ACTIONS.FULL) {
				const filePath = filesToBeAdded[0];
				const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
				filesToBeAdded = [dirPath];
			}
			if (change.c.toLowerCase() !== CATEGORY.VLOCITY && change.a.toLowerCase() === ACTIONS.DELETE) {
				filesToBeAdded = [
					...jsonAdditionalInfo.deleteMapping.cascadeLocators,
					...jsonAdditionalInfo.deleteMapping.nestedComponents.reduce((result, cmp) => {
						result.push(...cmp.cascadeLocators);
						return result;
					}, [])
				];
			}
			if (filesToBeAdded) {
				filePaths = new Set([...filePaths, ...filesToBeAdded]);
			}
		}
	});
	return [...filePaths];
}

function getRetrieveOnlyFilesToDiscard(commitChanges) {
	this.logger('START Get retrieve only files');
	let result = [];
	if (commitChanges.Sfdx.retrieveOnly?.length) {
		const addOnlyFiles = this.getFilePaths(
			COMMIT_CHANGES_FILE_PATH,
			[ACTIONS.ADD, ACTIONS.SELECTIVE_COMMIT, ACTIONS.ADD_WITH_SYSTEM_PERMISSION],
			[CATEGORY.SFDX]
		);
		const retrieveOnlyFiles = this.getFilePaths(COMMIT_CHANGES_FILE_PATH, [ACTIONS.RETRIEVE_ONLY], [CATEGORY.SFDX]);
		result = retrieveOnlyFiles.filter(item => !addOnlyFiles.includes(item));
	}
	this.logger('END Get retrieve only files');
	return result;
}

async function getUntrackedFiles() {
	const untrackedFiles = (
		await this.executeCommand(
			'git ls-files --others --exclude-standard',
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			RESULT_INFO.ADDITIONAL_INFORMATION.GIT_LIST_UNTRACKED_FILES
		)
	)
		?.split('\n')
		?.map(file => file?.trim())
		?.filter(file => file != '');
	return untrackedFiles;
}

async function executeCommandinChunks(fileList, chunkSize, cmd, cmdInfo) {
	if (fileList.length > 0) {
		let fileIndex = 0;
		do {
			let endIndex = fileIndex + parseInt(chunkSize) > fileList.length ? fileList.length : fileIndex + parseInt(chunkSize);
			let fileChunk = fileList.slice(fileIndex, endIndex);
			await this.executeCommand(
				cmd.replace(/REPLACE_VALUE/g, fileChunk.map(file => `'${file}'`).join(' ')),
				cmdInfo?.category,
				cmdInfo?.additionalInfo,
				true
			);
			fileIndex = endIndex;
		} while (fileIndex < fileList.length);
	}
}

async function discardFilesInGit(fileList) {
	if (fileList?.length) {
		const relativeFileList = fileList.map(filepath => {
			if (filepath.startsWith(TARGET_DIRECTORY)) {
				return filepath.substring(TARGET_DIRECTORY.length + 1);
			}
			return filepath;
		});

		const unTrackedFiles = await this.getUntrackedFiles();
		const toBeCleanedFiles = relativeFileList.filter(file => unTrackedFiles.includes(file));
		const trackedFiles = relativeFileList.filter(file => !toBeCleanedFiles.includes(file));
		toBeCleanedFiles?.length &&
			(await this.executeCommandinChunks(toBeCleanedFiles, chunkSize, 'git clean -fd REPLACE_VALUE', {
				category: RESULT_INFO.CATEGORY.GIT_SERVICE,
				additionalInfo: RESULT_INFO.ADDITIONAL_INFORMATION.GIT_CLEAN
			}));
		trackedFiles?.length &&
			(await this.executeCommandinChunks(trackedFiles, chunkSize, '( git checkout HEAD -- REPLACE_VALUE ) || true', {
				category: RESULT_INFO.CATEGORY.GIT_SERVICE,
				additionalInfo: RESULT_INFO.ADDITIONAL_INFORMATION.GIT_CHECKOUT
			}));
	}
}

function executeCommand(command, category, additionalInfo, disableMetrics, hasJsonResponse, disableLogs, options) {
	this.logger(`===> ${command}`);
	return new Promise((resolve, reject) => {
		let output = '',
			error = '';
		if (!disableMetrics) {
			this.startWatch(category, additionalInfo, processes);
		}
		const childProcess = child_process.spawn(command, [], options ? options : { shell: true });

		childProcess.stdout.on('data', data => {
			const outputStream = data?.toString();
			if (!disableLogs && outputStream) {
				this.logger(outputStream);
			}
			output += outputStream;
		});

		childProcess.stderr.on('data', data => {
			const errorStream = data?.toString();
			if (errorStream) {
				this.logger(errorStream);
				error += errorStream;
			}
		});

		childProcess.on('close', code => {
			if (code !== 0) {
				let errorMessage = '';
				if (hasJsonResponse) {
					try {
						resolve(JSON.parse(output));
					} catch (error) {
						errorMessage = error;
					}
				} else {
					errorMessage = error;
				}
				errorMessage = errorMessage ? errorMessage : `Error executing the command ${command.trim()}`;

				this.populateResultViewer(RESULT_INFO.LEVEL.ERROR, category, additionalInfo, errorMessage);
				const truncatedError = JSON.stringify(
					errorMessage
						.split('\n')
						.filter(msg => !msg.includes(COPADO_INFO_PREFIX))
						.join(' ')
				);
				reject(new CommandExecutionError(truncatedError, category, additionalInfo));
			}
			resolve(hasJsonResponse ? JSON.parse(output) : output);
			if (!disableMetrics) {
				this.endWatch(additionalInfo, processes);
			}
		});

		childProcess.on('error', error => {
			this.populateResultViewer(RESULT_INFO.LEVEL.ERROR, category, additionalInfo, error);
			const truncatedError = JSON.stringify(
				error
					.split('\n')
					.filter(msg => !msg.includes(COPADO_INFO_PREFIX))
					.join(' ')
			);
			reject(new CommandExecutionError(truncatedError, category, additionalInfo));
			if (!disableMetrics) {
				this.endWatch(additionalInfo, processes);
			}
		});
	});
}

async function getApiVersion(overriddenApiVersion, apiVersion) {
	const finalApiVersion = overriddenApiVersion || apiVersion;
	const regExpApiVersion = /\d\d\.0/;
	if (!regExpApiVersion.test(finalApiVersion)) {
		await this.executeCommand(this.getErrorCmdString(`Invalid API Version: ${finalApiVersion}`));
		process.exit(1);
	}
	return finalApiVersion;
}

function getPath(filePath) {
	return isTest ? `${__dirname}/__tests__/__mockDir__${filePath}` : filePath;
}

function uploadFile(filePath, name) {
	this.executeCommand(
		`copado --uploadfile ${filePath} ${name ? '--name ' + name : ''}`,
		RESULT_INFO.CATEGORY.COPADO_SERVICE,
		RESULT_INFO.ADDITIONAL_INFORMATION.UPLOAD_FILES
	);
}

function downloadFile(fileId, downloadDir) {
	return `copado --downloadfiles ${fileId} --downloaddir ${downloadDir}`;
}

async function validateCommitId(commitId) {
	if (commitId) {
		await this.handleCleanPullRequestOperations(commitId);
		await this.updateResultWithCommitDetails({ commitId });
		if (resultViewerJson?.length) {
			this.uploadResultViewerJson(resultViewerJson, RESULT_TABLE_COLUMNS, RESULT_TABLE_HEADER, HEADER_ICON);
		}
		process.exit(0);
	}
}

async function updateResultWithCommitDetails(resultData) {
	this.populateResultViewer(RESULT_INFO.LEVEL.INFO, RESULT_INFO.CATEGORY.COMMIT_INFO, '', `Commit Id : ${resultData?.commitId}`);
	await this.executeCommand(`copado -p 'Saving commit details' --result-data '${JSON.stringify(resultData)}'`);
}

function getGitDepth(gitDepth) {
	gitDepth = parseInt(gitDepth);
	return gitDepth >= 0 ? gitDepth : 100;
}

function fetchCheckoutBranch(branch, gitDepth, forceCreate) {
	return (
		`( copado-git-get -g "git fetch origin ${branch} --depth ${gitDepth}" && git checkout ${branch} ) ${
			hasPrefetchedVolume ? '&& copado-git-get -g "git pull origin ' + branch + ' --depth ' + gitDepth + '"' : ''
		}` + (forceCreate ? ` || git checkout -b ${branch}` : '')
	);
}

async function copyFiles(source, target) {
	await this.executeCommand(`cp -R ${source} ${target}`, RESULT_INFO.CATEGORY.FILE_SYSTEM, RESULT_INFO.ADDITIONAL_INFORMATION.COPY_FILES);
}

function asyncCopadoLogMessage(msg, logLevel) {
	if (msg) {
		this.populateResultViewer(logLevel ? logLevel : RESULT_INFO.LEVEL.INFO, RESULT_INFO.CATEGORY.COPADO_INFO, '', msg);

		this.executeCommand(`copado -p "${msg}"`, RESULT_INFO.CATEGORY.COPADO_SERVICE);
	}
}

function populateResultViewer(level, category, additionalInfo, message) {
	if (message) {
		resultViewerJson.push({
			Level: level,
			Category: category,
			AdditionalInformation: additionalInfo,
			Message: message
		});
	}
}

function uploadResultViewerJson(data, columns, header, headerIcon) {
	const RESULT_VIEWER_JSON_PATH = `${TEMP_DIRECTORY}/ResultViewer.json`;

	const fileContent = { data, columns, header, headerIcon };
	fs.writeFileSync(RESULT_VIEWER_JSON_PATH, JSON.stringify(fileContent, null, 2));
	this.uploadFileAtPath(RESULT_VIEWER_JSON_PATH);
}

function uploadFileAtPath(filePath) {
	this.executeCommand(`copado --uploadfile ${filePath}`, RESULT_INFO.CATEGORY.COPADO_SERVICE, RESULT_INFO.ADDITIONAL_INFORMATION.UPLOAD_FILES);
}

function logger(text) {
	console.log(text);
}

function buildManifest(changesList, manifestFileName) {
	// Create Map
	let metadataByType = new Map();
	changesList.forEach(change => {
		if (!metadataByType.has(change.t)) {
			metadataByType.set(change.t, new Set());
		}
		metadataByType.get(change.t).add(change.n);
	});

	// Create manifest file
	let manifest = [];
	manifest.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n');
	manifest.push('<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n');
	metadataByType.forEach((value, key) => {
		if (value && key) {
			manifest.push('\t<types>\n');
			value.forEach(item => {
				manifest.push(`\t\t<members>${item}</members>\n`);
			});

			manifest.push(`\t\t<name>${key}</name>\n`);
			manifest.push('\t</types>\n');
		}
	});

	manifest.push(`\t<version>${sourceApiVersion}</version>\n`);
	manifest.push('</Package>\n');

	fs.writeFileSync(manifestFileName, manifest.join(''));
}

function startWatch(processType, processName, processes) {
	if (!processName || !processType) {
		return;
	}
	const startTime = process.hrtime();
	if (!totalTimeByType[processType]) {
		totalTimeByType[processType] = 0;
	}
	processes.set(processName, { name: processName, type: processType, startTime, endTime: null, elapsedTime: null });
}

function endWatch(processName, processes) {
	if (!processName) {
		return;
	}

	if (!processes.has(processName)) {
		// we call endWatch in sync with startwatch for same process & doesnt overlap with others endWatch. additionally checking that it belongs to the same processType in the processes index before we store it.
		console.error(`Process '${processName}' not started.`);
		return;
	}
	const processEntry = processes.get(processName);
	const endTime = process.hrtime();
	const elapsedTime = process.hrtime(processEntry.startTime);
	processEntry.endTime = endTime;
	processEntry.elapsedTime = elapsedTime[0] * 1e9 + elapsedTime[1];
	processes.set(processName, processEntry);
}

function printMetrics() {
	let ux = new Ux();
	this.logger('\n');
	ux.styledHeader('====================      OVERALL METRICS      ====================');
	const resultData = [];
	for (const process of processes.values()) {
		// store data
		resultData.push({
			processType: '| ' + process.type,
			processName: '| ' + process.name,
			'startTime(UTC)': process.startTime ? '| ' + this.formatTime(process.startTime) : '| ' + 'N/A',
			'endTime(UTC)': process.endTime ? '| ' + this.formatTime(process.endTime) : '| ' + 'N/A',
			elapseTime: process.elapsedTime ? '| ' + `${(process.elapsedTime / 1e9).toFixed(2)} s` + ' |' : '| ' + 'N/A' + ' |'
		});
		// Aggregate total time by type
		if (process.elapsedTime) {
			if (!totalTimeByType[process.type]) {
				totalTimeByType[process.type] = 0;
			}
			totalTimeByType[process.type] += process.elapsedTime;
		}
	}

	ux.table(resultData, { processType: {}, processName: {}, 'startTime(UTC)': {}, 'endTime(UTC)': {}, elapseTime: {} });
	this.logger('\n' + '   ====================       EXECUTION SUMMARY      ====================   ');
	// Print total aggregate time by type
	Object.entries(totalTimeByType).forEach(([type, totalTime]) => {
		this.logger(`${type} Total Time: ${(totalTime / 1e9).toFixed(2)} seconds`);
	});
	this.logger('   ====================       EXECUTION SUMMARY      ====================   ' + '\n');
}

function formatTime(time) {
	const date = new Date(time[0] * 1000 + time[1] / 1e6);
	const hours = date.getUTCHours().toString().padStart(2, '0');
	const minutes = date.getUTCMinutes().toString().padStart(2, '0');
	const seconds = date.getUTCSeconds().toString().padStart(2, '0');
	const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');
	return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function getMetadataReconcilerRequest(profiles, operation) {
	const request = new CopaReconcilerInput();
	request.repositoryPath = TARGET_DIRECTORY;
	request.accessToken = sourceSessionId;
	request.instanceUrl = this.getInstanceUrl(sourceEndPoint);
	request.jsonOutputPath = TEMP_DIRECTORY;
	request.profiles = profiles;
	request.operation = operation;
	return request;
}

function getInstanceUrl(instanceUrl) {
	return instanceUrl?.substring(0, instanceUrl?.indexOf('/', instanceUrl?.indexOf('/') + 2));
}

function uploadSelectiveCommitFileOnResult(selectiveCommitFilePath, hash) {
	const hashCommitFile = `${hash}_${SELECTIVE_COMMIT_SUFFIX.COMMIT}`;
	this.uploadFile(selectiveCommitFilePath, hashCommitFile);
}

function getSelectiveCommitFile(metadataTypeAndName, selectiveCommitHash) {
	let result = '';
	if (fs.existsSync(`${TEMP_DIRECTORY}/${selectiveCommitHash}_${SELECTIVE_COMMIT_SUFFIX.SESSION}`)) {
		result = `${TEMP_DIRECTORY}/${selectiveCommitHash}_${SELECTIVE_COMMIT_SUFFIX.SESSION}`;
	} else if (fs.existsSync(`${TEMP_DIRECTORY}/${selectiveCommitHash}_${SELECTIVE_COMMIT_SUFFIX.COMMIT}`)) {
		result = `${TEMP_DIRECTORY}/${selectiveCommitHash}_${SELECTIVE_COMMIT_SUFFIX.COMMIT}`;
	} else {
		throw new Error(`Failed to find the Selected Changes for ${metadataTypeAndName}`);
	}
	return result;
}

function getFullNameFromMetadataXml(xmlContent) {
	const fullNameMatch = xmlContent?.match(/<fullName>([^<]*)<\/fullName>/);
	return fullNameMatch ? fullNameMatch[1] : null;
}

function overrideFullNameInMetadataXml(xmlContent, fullName) {
	if (!fullName || !xmlContent) {
		return xmlContent;
	}
	if (/<fullName>[^<]*<\/fullName>/.test(xmlContent)) {
		return xmlContent.replace(/<fullName>[^<]*<\/fullName>/, `<fullName>${fullName}</fullName>`);
	}
	return xmlContent;
}

function applySelectiveCommitContentPreservingFullName(metadataFilePath, selectiveCommitContent) {
	let contentToWrite = selectiveCommitContent;
	if (metadataFilePath.endsWith('.xml')) {
		const originalFullName = this.getFullNameFromMetadataXml(fs.readFileSync(metadataFilePath, 'utf-8'));
		if (originalFullName) {
			contentToWrite = this.overrideFullNameInMetadataXml(selectiveCommitContent, originalFullName);
		}
	}
	fs.writeFileSync(metadataFilePath, contentToWrite);
}

function updateFilePathsForCustomLabels() {
	const enrichedChanges = this.readFromPath(COMMIT_CHANGES_FILE_PATH);
	enrichedChanges?.forEach(change => {
		if (CUSTOM_LABELS.includes(change.t?.toLowerCase()) && [ACTIONS.ADD, ACTIONS.RETRIEVE_ONLY, ACTIONS.FULL].includes(change.a?.toLowerCase())) {
			if (!(change.j && change.j !== '' && JSON.parse(change.j)?.filePath?.length)) {
				const jsonAdditionalInfo = {
					filePath: [this.getCustomLabelFilePath()]
				};
				change.j = JSON.stringify(jsonAdditionalInfo);
				fs.writeFileSync(COMMIT_CHANGES_FILE_PATH, JSON.stringify(enrichedChanges, null, 2));
			}
		}
	});
}

function getCustomLabelFilePath() {
	const sfdxProjectJsonPath = `${TARGET_DIRECTORY}/sfdx-project.json`;
	const fileContent = this.readFromPath(sfdxProjectJsonPath);
	const defaultPackageDirectory = fileContent.packageDirectories[0].path;
	return defaultPackageDirectory + '/' + CUSTOM_LABEL_RETRIEVE_FILE_PATH;
}

function updateForceIgnore() {
	fs.appendFileSync(`${TARGET_DIRECTORY}/${FORCE_IGNORE}`, '\n**/CustomLabels.labels-meta.xml');
}

function findErrorsAndWarningsDuringRetrieval(enrichedChangesFilePath, retrieveResultFilePath) {
	const enrichedChanges = this.readFromPath(enrichedChangesFilePath),
		retrieveResult = this.readFromPath(retrieveResultFilePath),
		errors = [],
		warnings = [],
		changesNotRetrieved = new Set();

	enrichedChanges.forEach(change => {
		const jsonAdditionalInfo = JSON.parse(change.j);
		if (!jsonAdditionalInfo.isRetrieved && change.a?.toLowerCase() !== ACTIONS.DELETE && !CUSTOM_LABELS.includes(change.t?.toLowerCase())) {
			changesNotRetrieved.add(`${change.t}:${change.n}`);
		}
	});

	retrieveResult?.result?.files?.forEach(file => {
		if (file.state === 'Failed') {
			if (changesNotRetrieved.has(`${file.type}:${file.fullName}`) && !RETRIEVE_ERRORS_TO_BE_DISCARDED.includes(file.error?.toLowerCase())) {
				errors.push(file.error);
			} else {
				warnings.push(file.error);
			}
		}
	});
	if (errors?.length) {
		const message = JSON.stringify({ warnings: warnings.join(','), errors: errors.join(',') });
		this.populateResultViewer(
			RESULT_INFO.LEVEL.ERROR,
			RESULT_INFO.CATEGORY.SFDX_CLI,
			RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL,
			message
		);
		throw new CommandExecutionError(message, RESULT_INFO.CATEGORY.SFDX_CLI, RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL);
	} else if (warnings?.length) {
		this.populateResultViewer(
			RESULT_INFO.LEVEL.WARN,
			RESULT_INFO.CATEGORY.SFDX_CLI,
			RESULT_INFO.ADDITIONAL_INFORMATION.METADATA_RETRIEVAL,
			warnings.join(',')
		);
	}
}

function printChanges(changes) {
	this.logger(`Metadata list as JSON: ${JSON.stringify(changes)}`);
}

function createDefaultDirectory() {
	const sfdxProjectJsonPath = `${TARGET_DIRECTORY}/sfdx-project.json`;
	const fileContent = this.readFromPath(sfdxProjectJsonPath);
	const defaultPackageDirectory = fileContent.packageDirectories.find(packageDirectory => packageDirectory.default == true);
	const defaultDirectory = defaultPackageDirectory.path;
	if (!fs.existsSync(defaultDirectory)) {
		fs.mkdirSync(defaultDirectory);
	}
}

function updateBundledMetadataSelections(bundledMetadataSelections, retrieveResult) {
	const updateSelections = selections => {
		for (const [key, selectedPaths] of Object.entries(selections)) {
			const [type, name] = key.split(':');
			const retrievedFiles = retrieveResult?.result?.files?.filter(file => file.type === type && file.fullName === name);

			if (retrievedFiles?.length) {
				for (let i = 0; i < selectedPaths.length; i++) {
					const selectedPath = selectedPaths[i];
					const match = retrievedFiles.find(file => file.filePath && file.filePath.endsWith(selectedPath));
					if (match) {
						selectedPaths[i] = match.filePath.replace(`${TARGET_DIRECTORY}/`, '');
					}
				}
			}
		}
	};

	if (bundledMetadataSelections.sessionSelections) {
		updateSelections(bundledMetadataSelections.sessionSelections);
	}
	if (bundledMetadataSelections.commitSelections) {
		updateSelections(bundledMetadataSelections.commitSelections);
	}
	return bundledMetadataSelections;
}

// Clean Pull Request Main function
async function handleCleanPullRequestOperations(featureCommitId) {
	if (!this.isCleanPullRequestEnabled()) {
		return;
	}
	const isolationBranchExists = await this.checkIsolationBranchExists();
	if (isolationBranchExists) {
		await this.handleExistingIsolationBranch(featureCommitId);
	}
}

// Clean Pull Request Helper Functions
function isCleanPullRequestEnabled() {
	return cleanPullRequestEnabled && cleanPullRequestEnabled.toLowerCase() === 'true';
}

function getIsolationBranchName() {
	return `isolation/${featureBranch}`;
}

async function checkIsolationBranchExists() {
	const isolationBranchName = this.getIsolationBranchName();
	const remoteHeads = await this.executeCommand(
		`git ls-remote --heads origin ${isolationBranchName}`,
		RESULT_INFO.CATEGORY.GIT_SERVICE,
		`Check if isolation branch ${isolationBranchName} exists`,
		true
	);
	const exists = Boolean((remoteHeads || '').trim());
	this.logger(
		exists ? `Isolation branch ${isolationBranchName} exists` : `Isolation branch ${isolationBranchName} does not exist`
	);
	return exists;
}

async function hasUnmergedPaths() {
	const output = await this.executeCommand(
		`git diff --name-only --diff-filter=U`,
		RESULT_INFO.CATEGORY.GIT_SERVICE,
		`Check for unmerged conflict paths`,
		true
	);
	return Boolean((output || '').trim());
}

async function resolveCherryPickConflicts() {
	// Feature branch always wins; only unmerged paths are updated.
	// Before removing a file, explicitly confirms the theirs stage (stage 3) is absent,
	// so only genuine modify/delete conflicts trigger git rm rather than masking other errors.
	// git cherry-pick --continue --no-edit keeps the original feature commit metadata.
	const unmergedListFile = `${TEMP_DIRECTORY}/copado_unmerged_paths.txt`;
	await this.executeCommand(
		`git diff --name-only --diff-filter=U > "${unmergedListFile}"`,
		RESULT_INFO.CATEGORY.GIT_SERVICE,
		`Capture unmerged cherry-pick paths`,
		true
	);
	const resolveConflicts = [
		`while IFS= read -r f || [ -n "$f" ]; do [ -n "$f" ] || continue; if git show :3:"$f" -- > /dev/null 2>&1; then git checkout --theirs -- "$f"; else git rm -f -- "$f"; fi; done < "${unmergedListFile}"`,
		`git add -A`,
		`GIT_EDITOR=true git cherry-pick --continue --no-edit`
	].join(' && ');
	this.logger('Conflicts detected during cherry-pick, resolving with feature branch winning...');
	await this.executeCommand(
		resolveConflicts,
		RESULT_INFO.CATEGORY.GIT_SERVICE,
		`Resolve cherry-pick conflicts with feature branch changes`,
		true
	);
	this.logger('Conflicts resolved - feature branch changes preserved');
}

async function cherryPickCommitToIsolationBranch(commitSha) {
	this.logger(`Cherry-picking feature commit ${commitSha} to isolation branch`);
	try {
		await this.executeCommand(
			`git cherry-pick ${commitSha}`,
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			`Cherry-pick commit ${commitSha} to isolation branch`,
			true
		);
	} catch (error) {
		if (error.message.includes('previous cherry-pick is now empty') || error.message.includes('nothing to commit')) {
			this.logger('Cherry-pick resulted in no changes, skipping with git cherry-pick --skip');
			await this.executeCommand(`git cherry-pick --skip`, RESULT_INFO.CATEGORY.GIT_SERVICE, `Skip empty cherry-pick`, true);
		} else if (await this.hasUnmergedPaths()) {
			await this.resolveCherryPickConflicts();
		} else {
			throw error;
		}
	}
}

function parseWorkPushCommitIds(jsonInformation) {
	try {
		const commitIds = JSON.parse(jsonInformation).commitIds;
		if (!Array.isArray(commitIds) || commitIds.some(commitId => typeof commitId !== 'string' || !commitId.trim())) {
			throw new Error();
		}
		//cherry-picks must be applied oldest first.
		return commitIds.map(commitId => commitId.trim()).reverse();
	} catch {
		throw new Error('Invalid workPushCommitIds.');
	}
}

async function isCommitAlreadyInIsolationBranch(commitId) {
	this.logger(`Checking if commit ${commitId} is already in isolation branch`);
	try {
		await this.executeCommand(
			`git merge-base --is-ancestor "${commitId.trim()}" HEAD`,
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			`Check if commit ${commitId} is already in branch`,
			true
		);
		this.logger(`Commit ${commitId} is already in isolation branch, skipping cherry-pick`);
		return true;
	} catch {
		this.logger(`Commit ${commitId} is not in isolation branch, proceeding with cherry-pick`);
		return false;
	}
}

async function updateIsolationBranch(featureCommitId) {
	this.logger('START Updating isolation branch with latest commit');
	const isolationBranchName = this.getIsolationBranchName();

	try {
		// Fetch the isolation branch
		await this.executeCommand(
			`copado-git-get -g "git fetch origin ${isolationBranchName}"`,
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			`Fetch isolation branch ${isolationBranchName}`,
			true
		);

		// Checkout the isolation branch
		await this.executeCommand(
			`git checkout ${isolationBranchName}`,
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			`Checkout isolation branch ${isolationBranchName}`,
			true
		);

		// CLI path: commitId is present — cherry-pick the supplied US commits oldest first.
		// UI path: commitId is absent — cherry-pick the single featureCommitId from this run.
		if (process.env.commitId) {
			await this.executeCommand(
				`copado-git-get -g "git fetch origin ${featureBranch}"`,
				RESULT_INFO.CATEGORY.GIT_SERVICE,
				`Fetch feature branch ${featureBranch}`,
				true
			);

			const cliCommitIds = jsonInformation ? this.parseWorkPushCommitIds(jsonInformation) : [commitId.trim()];
			let isolationBranchUpdated = false;
			for (const cliCommitId of cliCommitIds) {
				if (await this.isCommitAlreadyInIsolationBranch(cliCommitId)) {
					continue;
				}
				await this.cherryPickCommitToIsolationBranch(cliCommitId);
				isolationBranchUpdated = true;
			}
			if (!isolationBranchUpdated) {
				this.logger('No CLI commits need to be cherry-picked onto isolation branch');
				return;
			}
		} else {
			if (await this.isCommitAlreadyInIsolationBranch(featureCommitId)) {
				this.logger('END Updating isolation branch with latest commit');
				return;
			}
			await this.cherryPickCommitToIsolationBranch(featureCommitId);
		}

		// Push the updated isolation branch
		await this.executeCommand(
			`copado-git-get -g "git push origin ${isolationBranchName}"`,
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			`Push updated isolation branch`,
			true
		);

		this.logger('END Updating isolation branch with latest commit');
	} catch (error) {
		this.logger(`Error updating isolation branch: ${error.message}`);
		throw error;
	}
}

async function deleteIsolationBranch() {
	this.logger('START Deleting isolation branch');
	const isolationBranchName = this.getIsolationBranchName();

	try {
		// Delete remote isolation branch
		await this.executeCommand(
			`copado-git-get -g "git push origin --delete ${isolationBranchName}"`,
			RESULT_INFO.CATEGORY.GIT_SERVICE,
			`Delete remote isolation branch ${isolationBranchName}`,
			true
		);

		this.logger('END Deleting isolation branch');
	} catch (error) {
		this.logger(`Error deleting isolation branch: ${error.message}`);
		throw error;
	}
}

function shouldRecreateIsolationBranch() {
	const { recreateIfExists } = process.env;
	return recreateIfExists && recreateIfExists.toLowerCase() === 'true';
}

async function handleExistingIsolationBranch(featureCommitId) {
	if (this.shouldRecreateIsolationBranch()) {
		this.logger('Feature branch recreation enabled, deleting isolation branch');
		await this.deleteIsolationBranch();
	} else {
		this.logger('Isolation branch exists and feature branch recreation disabled, updating isolation branch');
		await this.updateIsolationBranch(featureCommitId);
	}
}

function appendCustomSuffixToCommitMessage(commitMessage) {
	const messageWithSuffix = customCommitMessageSuffix ? `${commitMessage} ${customCommitMessageSuffix}` : commitMessage;
	// Escape special characters in the full sentence after concatenation to avoid syntax errors
	return messageWithSuffix.replace(/[`"$\\]/g, '\\$&');
}

// INNER CLASS
class CommandExecutionError extends Error {
	constructor(message, category, additionalInfo) {
		super(`${category ? category + ' - ' : ''}${additionalInfo ? additionalInfo + ' : ' : ''}${message}`);
		this.name = CUSTOM_ERROR.COMMAND_EXECUTION_ERROR;
	}
}

module.exports.encodeFileNames = encodeFileNames;
module.exports.getCommitChanges = getCommitChanges;
module.exports.executeCommand = executeCommand;
module.exports.discardFilesInGit = discardFilesInGit;
module.exports.getUntrackedFiles = getUntrackedFiles;
module.exports.executeCommandinChunks = executeCommandinChunks;
module.exports.getRetrieveOnlyFilesToDiscard = getRetrieveOnlyFilesToDiscard;
module.exports.getFilePaths = getFilePaths;
module.exports.readFromPath = readFromPath;
module.exports.getErrorCmdString = getErrorCmdString;
module.exports.gitPush = gitPush;
module.exports.getCommitId = getCommitId;
module.exports.commitAndUpdateEnvironmentBranches = commitAndUpdateEnvironmentBranches;
module.exports.processMetadata = processMetadata;
module.exports.getPreserveUserPermissionsParameter = getPreserveUserPermissionsParameter;
module.exports.isEnableFalseTagPermissionsEnabled = isEnableFalseTagPermissionsEnabled;
module.exports.getEnableFalseTagPermissionsParameter = getEnableFalseTagPermissionsParameter;
module.exports.isNewCommitExperienceEnabled = isNewCommitExperienceEnabled;
module.exports.gitCommit = gitCommit;
module.exports.findAndReplace = findAndReplace;
module.exports.execute = execute;
module.exports.fetchCreateFeatureBranch = fetchCreateFeatureBranch;
module.exports.getFilesRetrievedInTargetDirectory = getFilesRetrievedInTargetDirectory;
module.exports.varReplace = varReplace;
module.exports.retrieveOrgMetadata = retrieveOrgMetadata;
module.exports.retrieveFullProfile = retrieveFullProfile;
module.exports.sfdxRetrieve = sfdxRetrieve;
module.exports.configureSFDXCLI = configureSFDXCLI;
module.exports.authenticateSFDXCLI = authenticateSFDXCLI;
module.exports.getSfdxCliExecuteOptions = getSfdxCliExecuteOptions;
module.exports.getTargetOrgFlag = getTargetOrgFlag;
module.exports.initializeSfdxCliAuth = initializeSfdxCliAuth;
module.exports.checkSFDXProjectJson = checkSFDXProjectJson;
module.exports.setup = setup;
module.exports.checkNestedParentMetadataDeletion = checkNestedParentMetadataDeletion;
module.exports.prepareMetadataChangesList = prepareMetadataChangesList;
module.exports.isAddWithSystemPermissionChange = isAddWithSystemPermissionChange;
module.exports.configureGit = configureGit;
module.exports.getApiVersion = getApiVersion;
module.exports.validateCommittedChanges = validateCommittedChanges;
module.exports.uploadFile = uploadFile;
module.exports.downloadFile = downloadFile;
module.exports.mergeFeatureBranchInSource = mergeFeatureBranchInSource;
module.exports.validateCommitId = validateCommitId;
module.exports.updateResultWithCommitDetails = updateResultWithCommitDetails;
module.exports.initialSetup = initialSetup;
module.exports.setupGitRepository = setupGitRepository;
module.exports.createTargetDirectoryAndFetchBaseBranch = createTargetDirectoryAndFetchBaseBranch;
module.exports.changeWorkingDirectory = changeWorkingDirectory;
module.exports.enrichChangeList = enrichChangeList;
module.exports.getEnrichServiceCommand = getEnrichServiceCommand;
module.exports.getGitDepth = getGitDepth;
module.exports.fetchCheckoutBranch = fetchCheckoutBranch;
module.exports.hasConflict = hasConflict;
module.exports.copyFiles = copyFiles;
module.exports.getSFChanges = getSFChanges;
module.exports.finishCommit = finishCommit;
module.exports.asyncCopadoLogMessage = asyncCopadoLogMessage;
module.exports.executeAfterCommitOperations = executeAfterCommitOperations;
module.exports.updateCommitChangeFileWithProfilePaths = updateCommitChangeFileWithProfilePaths;
module.exports.populateResultViewer = populateResultViewer;
module.exports.uploadResultViewerJson = uploadResultViewerJson;
module.exports.uploadFileAtPath = uploadFileAtPath;
module.exports.logger = logger;
module.exports.buildManifest = buildManifest;
module.exports.startWatch = startWatch;
module.exports.endWatch = endWatch;
module.exports.formatTime = formatTime;
module.exports.printMetrics = printMetrics;
module.exports.getInstanceUrl = getInstanceUrl;
module.exports.getMetadataReconcilerRequest = getMetadataReconcilerRequest;
module.exports.handleSelectiveCommitOperations = handleSelectiveCommitOperations;
module.exports.updateFilePathsInEnrichedFile = updateFilePathsInEnrichedFile;
module.exports.downloadAndReadSelectedFilesForBundledMetadata = downloadAndReadSelectedFilesForBundledMetadata;
module.exports.getFilesToBeDiscardedFromBundle = getFilesToBeDiscardedFromBundle;
module.exports.uploadSelectiveCommitFileOnResult = uploadSelectiveCommitFileOnResult;
module.exports.getSelectiveCommitFile = getSelectiveCommitFile;
module.exports.getFullNameFromMetadataXml = getFullNameFromMetadataXml;
module.exports.overrideFullNameInMetadataXml = overrideFullNameInMetadataXml;
module.exports.applySelectiveCommitContentPreservingFullName = applySelectiveCommitContentPreservingFullName;
module.exports.retrieveCustomLabel = retrieveCustomLabel;
module.exports.createSfdxProjectWithDefaultRepositoryPathCustomLabels = createSfdxProjectWithDefaultRepositoryPathCustomLabels;
module.exports.handleCustomLabelRetrieveResult = handleCustomLabelRetrieveResult;
module.exports.getFilesFromRetrieveResult = getFilesFromRetrieveResult;
module.exports.getFilesRetrievedForCustomLabels = getFilesRetrievedForCustomLabels;
module.exports.getCustomLabelFilePath = getCustomLabelFilePath;
module.exports.updateFilePathsForCustomLabels = updateFilePathsForCustomLabels;
module.exports.hasRelevantGitChanges = hasRelevantGitChanges;
module.exports.updateForceIgnore = updateForceIgnore;
module.exports.findErrorsAndWarningsDuringRetrieval = findErrorsAndWarningsDuringRetrieval;
module.exports.printChanges = printChanges;
module.exports.createDefaultDirectory = createDefaultDirectory;
module.exports.updateBundledMetadataSelections = updateBundledMetadataSelections;

// Clean Pull Request exports
module.exports.isCleanPullRequestEnabled = isCleanPullRequestEnabled;
module.exports.getIsolationBranchName = getIsolationBranchName;
module.exports.checkIsolationBranchExists = checkIsolationBranchExists;
module.exports.hasUnmergedPaths = hasUnmergedPaths;
module.exports.resolveCherryPickConflicts = resolveCherryPickConflicts;
module.exports.cherryPickCommitToIsolationBranch = cherryPickCommitToIsolationBranch;
module.exports.parseWorkPushCommitIds = parseWorkPushCommitIds;
module.exports.isCommitAlreadyInIsolationBranch = isCommitAlreadyInIsolationBranch;
module.exports.updateIsolationBranch = updateIsolationBranch;
module.exports.deleteIsolationBranch = deleteIsolationBranch;
module.exports.shouldRecreateIsolationBranch = shouldRecreateIsolationBranch;
module.exports.handleExistingIsolationBranch = handleExistingIsolationBranch;
module.exports.handleCleanPullRequestOperations = handleCleanPullRequestOperations;
module.exports.appendCustomSuffixToCommitMessage = appendCustomSuffixToCommitMessage;

// EXECUTION

!isTest && this.execute(commitChanges);