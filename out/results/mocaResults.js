"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MocaResults = void 0;
class MocaResults {
    constructor(data) {
        if (data['results']) {
            if (data['results']['metadata']) {
                this.cols = data['results']['metadata'];
            }
            else {
                this.cols = [];
            }
            if (data['results']['values']) {
                this.rows = data['results']['values'];
            }
            else {
                this.rows = [];
            }
        }
        else {
            this.cols = [];
            this.rows = [];
        }
        if (data['exception']) {
            if (data['exception']['message']) {
                this.msg = data['exception']['message'];
            }
            else {
                this.msg = "";
            }
        }
        else {
            this.msg = "";
        }
        if (data['needsApprovalToExecute']) {
            this.needsApprovalToExecute = true;
        }
        else {
            this.needsApprovalToExecute = false;
        }
        if (data['superUser']) {
            this.superUser = true;
        }
        else {
            this.superUser = false;
        }
    }
}
exports.MocaResults = MocaResults;
//# sourceMappingURL=mocaResults.js.map