import Selection from './Selection.js';

class TaskDependencySelection extends Selection {
    constructor (options) {
        super(...arguments);

        this.primitiveName = options.primitiveName;
        this.primitiveDetails = options.primitiveDetails;
    }

    /**
     * Add selection-specific arguments to /primitiveTraceForward API endpoint,
     * and fetch the data
     */
    async getUtilization (urlArgs) {
        var results = {};

        urlArgs.primitive = undefined;
        if(Array.isArray(this.primitiveName)) {
            urlArgs.primitives = this.primitiveName.join();
        } else {
            urlArgs.primitives = this.primitiveName;
        }
        urlArgs.nodeId = this.primitiveDetails;
        const url = `/datasets/${window.controller.currentDatasetId}/primitives/primitiveTraceForward?` +
            Object.entries(urlArgs).map(([key, value]) => {
                return `${key}=${encodeURIComponent(value)}`;
            }).join('&');
        const response = await window.fetch(url);
        const json = await response.json();

        if(urlArgs.isCombine === true) {
            var binSize = (urlArgs.end - urlArgs.begin) / urlArgs.bins;
            results['data'] = new Array(urlArgs.bins).fill(0);
            for (const [location, aggregatedTimes] of Object.entries(json.data)) {
                for (let aggTime of aggregatedTimes) {
                    let snappedStartBin = Math.floor(( aggTime.startTime - urlArgs.begin) / binSize) - 1;
                    aggTime.util.forEach((d,j)=>{
                        results['data'][j + snappedStartBin] = results['data'][j + snappedStartBin] + d;
                    });
                }
            }
        } else {
            results = json;
        }
        return results;
    }

    /**
     * A short string that identifies the selection
     */
    get label () {
        return this.primitiveName;
    }

    /**
     * All the details about this primitive; for now we just dump
     * pretty-printed JSON
     */
    get details () {
        return JSON.stringify(this.primitiveDetails, null, 2);
    }
}
export default TaskDependencySelection;
