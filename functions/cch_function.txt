export JAVA_TOOL_OPTIONS="-XX:CompressedClassSpaceSize=256m -XX:MaxMetaspaceSize=512m -XX:MaxRAMPercentage=50.0"

parseBranchesAndFileIdJson() {
	echo $branchesAndFileIdJson
    if [ "$(jq -r '.skipScan // empty' <<< $branchesAndFileIdJson)" == "true" ]; then
		copado -p "The scan was skipped because there are no files to analyze."
		exit 0
    fi
    originBranch=$(jq -r '.originBranch' <<< $branchesAndFileIdJson)
    destinationBranch=$(jq -r '.destinationBranch' <<< $branchesAndFileIdJson)
    rulesetFileId=$(jq -r '.rulesetFileId' <<< $branchesAndFileIdJson)
    changesFileId=$(jq -r '.changesFileId // empty' <<< $branchesAndFileIdJson)
    if [[ "$originBranch" == *"null"* || "$destinationBranch" == "null" ]]; then
  		copado -p "Error" -e "There was some issue executing the scan. Please check logs for more information" && exit 1
	fi
}

getSelectedChanges() {
	if jq -e 'has("metadataNames")' <<< "$branchesAndFileIdJson" > /dev/null; then
		if ! jq -e '.metadataNames | type == "array"' <<< "$branchesAndFileIdJson" > /dev/null; then
			copado -p "Error" -e "The User Story metadata scope is not a JSON array." && exit 1
		fi

		committed_names=$(jq -r '
			.metadataNames[]
			| gsub("\\\\"; "/")
			| split("/")[-1]
			| split(".")[-1]
		' <<< "$branchesAndFileIdJson" | sort -u)
	else
		if [ -z "$changesFileId" ] || [ "$changesFileId" == "null" ]; then
			copado -p "The scan was skipped because no promotion changes file was found."
			exit 0
		fi

		changes_directory="/tmp/selected-changes-$$"
		mkdir -p "$changes_directory"

		if ! copado --downloadfiles "$changesFileId" --downloaddir "$changes_directory"; then
			copado -p "Error" -e "Unable to download the promotion changes file." && exit 1
		fi

		changes_file=$(find "$changes_directory" -type f -print -quit)
		if [ -z "$changes_file" ]; then
			copado -p "Error" -e "The promotion changes download did not contain a file." && exit 1
		fi

		if ! jq -e 'type == "array"' "$changes_file" > /dev/null; then
			copado -p "Error" -e "The promotion changes file does not contain a JSON array." && exit 1
		fi

		committed_names=$(jq -r '
			.[]
			| select((((.a // "") | ascii_downcase | startswith("del")) | not))
			| .n // empty
			| gsub("\\\\"; "/")
			| split("/")[-1]
			| split(".")[-1]
		' "$changes_file" | sort -u)
	fi

	if [ -z "$committed_names" ]; then
		copado -p "The scan was skipped because the selected scope contains no scannable changes."
		exit 0
	fi
}

isCommittedFile() {
	file_name="$1"
	while IFS= read -r committed_name; do
		if [[ "$file_name" == "$committed_name" || "$file_name" == "$committed_name".* || "$file_name" == "$committed_name"-* ]]; then
			return 0
		fi
	done <<< "$committed_names"
	return 1
}

getCode() {
 	copado -p "Fetching Git branches: $originBranch"
	mkdir code && cd code
 	git_depth=${git_depth:-100}
 	copado-git-get --depth "$git_depth" "$originBranch"
}

getDiffFiles() {
	copado -p "Comparing $originBranch with $destinationBranch to obtain diffs"
    copado-git-get -g "git fetch origin $originBranch $destinationBranch"
    git checkout $destinationBranch
    git checkout $originBranch
	diff=$(git diff --name-only --diff-filter=d origin/$destinationBranch...origin/$originBranch)
	files=""

	while IFS= read -r changed_file; do
		[ -z "$changed_file" ] && continue
		file="${changed_file##*/}"
		if isCommittedFile "$file"; then
			files="$files$file,"
		fi
	done <<< "$diff"
    
   	if [ -z "$files" ]
    then
        copado -p "The scan was skipped because no committed files were found in the Git difference or destructive changes are being performed."
        exit 0
    else
        files=${files::-1}
    fi
}

removeUnwantedFiles() {
	cd ..
	base_command="find 'code/' -type f"
    IFS=',' read -ra file_array <<< "$files"
    
    for value in "${file_array[@]}";
    do	
    	value=$(echo "$value" | sed 's/[)(]//g' | sed 's/,/ /g')
    	base_command="${base_command} -not -iname '${value}'"
    done
   
	base_command="${base_command} -delete"
    eval ${base_command}
}

getRuleset() {
	copado -p "Downloading Ruleset file"
	copado --downloadfiles "$rulesetFileId" --downloaddir /tmp/
	ruleset=$(</tmp/"$RulesetFileName")
}

runOriginBranchScan() {
	copado -p "Running Scan"
    echo "PMD version"
    pmd --version
    
    fileExtension=$(file --mime-type -b /tmp/ruleset)
    if [ "$fileExtension" = 'application/zip' ];
    then
        cd /tmp
        mv ruleset ruleset.zip
        unzip -o ruleset.zip -d ruleset
        cd /app
        echo "filenames.."
        filenames=$(copado-get-file-names --directoryName /tmp/ruleset) 
        echo $filenames
	    pmd check -d code/ -f sarif -R $filenames > scan-output.sarif.json || true
    else
        pmd check -d code/ -f sarif -R /tmp/ruleset > scan-output.sarif.json || true
    fi
}

getFilesInDestinationBranch() {
  	mkdir dest && cd dest
  	copado-git-get "$destinationBranch"
  	cd ..
  
	base_command="find 'dest/' -type f"
    
    IFS=',' read -ra file_array <<< "$files"
    for value in "${file_array[@]}";
    do	
    	value=$(echo "$value" | sed 's/[)(]//g' | sed 's/,/ /g')
    	base_command="${base_command} -not -iname '${value}'"
    done

	base_command="${base_command} -delete"

	echo ${base_command}
	eval ${base_command}
}

runDestinationBranchScan() {
    
    if [ -f "/tmp/ruleset.zip" ];
    then
        filenames=$(copado-get-file-names --directoryName /tmp/ruleset) 
        echo $filenames
	    pmd check -d dest/ -f sarif -R $filenames > scan-dest-output.sarif.json || true
    else
        pmd check -d dest/ -f sarif -R /tmp/ruleset > scan-dest-output.sarif.json || true
    fi
}

deltaScanOutput() {
######################## DELTA SCAN NODE.JS SCRIPT START ########################
cat << __EOF__ > ./main.js
const fs = require('fs');

const sarifDest = JSON.parse(fs.readFileSync('scan-dest-output.sarif.json'));
const sarifSrc = JSON.parse(fs.readFileSync('scan-output.sarif.json'));

const originalViolations = flatten(sarifDest);
const latestViolations = flatten(sarifSrc);

const originalKeys = new Set(
    originalViolations.map(({ ruleId, uri, region }) =>
        createComparisonKey(ruleId, uri, region)
    )
);

const deltaViolations = latestViolations.filter(({ ruleId, uri, region }) => {
    const key = createComparisonKey(ruleId, uri, region);
    return !originalKeys.has(key);
});

const deltaSarif = createDeltaSarif(sarifSrc, deltaViolations);
fs.writeFileSync('delta.sarif.json', JSON.stringify(deltaSarif, null, 2));

function createDeltaSarif(completeSarif, deltaViolations) {
    const result = completeSarif;

    result.runs[0].tool.driver.rules = result.runs[0].tool.driver.rules.filter((rule) => idInViolations(rule.id, deltaViolations));

    result.runs[0].results = result.runs[0].results.filter((result) => idInViolations(result.ruleId, deltaViolations));

    result.runs[0].results = result.runs[0].results.filter((result) => {
        result.locations = result.locations.filter((location) => {
            let isNewLocation = false;

            deltaViolations.forEach((newViolation) => {
                if (result.ruleId == newViolation.ruleId &&
                    withoutPrefix(location.physicalLocation.artifactLocation.uri) == newViolation.uri &&
                    JSON.stringify(location.physicalLocation.region) == JSON.stringify(newViolation.region)) {
                        isNewLocation = true;
                    }
            })

            return isNewLocation;
        });

        return result.locations.length > 0;
    });

    return result;
}



function idInViolations(id, violations) {
    let result = false;

    violations.forEach((violation) => {
        if (id == violation.ruleId) {
            result = true;
        }
    });

    return result;
}

function flatten(sarif) {
    return sarif.runs[0].results.reduce( (result, ruleViolations) =>
            result.concat(ruleViolations.locations.map((location) => {
                return {
                    ruleId: ruleViolations.ruleId,
                    region: location.physicalLocation.region,
                    uri: withoutPrefix(location.physicalLocation.artifactLocation.uri)
                }
            }))
    , []);
}

function createComparisonKey(ruleId, uri, region) {
    const { startColumn = 0, endColumn = 0 } = region || {};
    const key = ruleId + '|' + uri + '|' + startColumn + '|' + endColumn;
    return key;
}

function withoutPrefix(uri) {
    return uri.split('code/').pop().split('dest/').pop();
}
__EOF__
######################## DELTA SCAN NODE.JS SCRIPT END ########################

	violations=$(node main.js)
}

attachTestResults() {
	copado -p "Uploading Analysis Output"
	
	if [ -n "$testResultIds" ];
    then
      testResultsIds=$(echo $testResultIds | sed -e "s/\[//g" | sed -e "s/\]//g" | sed -e "s/ //g" | xargs)
       for testResultId in `echo $testResultsIds | sed 's/[)(]//g' | sed 's/,/ /g'`
       do
       	   if [ "$deltaScan" == 'true' ];
           then
               copado -u delta.sarif.json --name "scan-output.sarif.json" --parentid $testResultId
           else
               copado -u scan-output.sarif.json --parentid $testResultId
           fi 
	   done
    fi
}

attachResult(){
    if [ "$deltaScan" == 'true' ];
    then
    copado -u delta.sarif.json --name "scan-output.sarif.json"
    else
    copado -u scan-output.sarif.json
    fi
}

attachConsolidatedResult(){
      if [ "$deltaScan" == 'true' ];
      then
        copado -u delta.sarif.json --name "scan-output.sarif.json" --parentid $consolidatedResultId
else
        copado -u scan-output.sarif.json --parentid $consolidatedResultId
      fi 
}

parseBranchesAndFileIdJson
getSelectedChanges
getCode
getDiffFiles
removeUnwantedFiles
getRuleset
runOriginBranchScan
if [ "$deltaScan" == 'true' ];
then
	copado -p "Executing Delta Scan"
	getFilesInDestinationBranch
	runDestinationBranchScan
	deltaScanOutput
fi
attachTestResults
attachResult

if [ -n "$consolidatedResultId" ];
then
	attachConsolidatedResult
fi