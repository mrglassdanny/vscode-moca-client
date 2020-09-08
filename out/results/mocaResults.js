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
            const dateFormat = require('dateformat');
            if (data['results']['values']) {
                this.rows = data['results']['values'];
                // Checking for datetime type for formatting purposes.
                for (var i = 0; i < this.cols.length; i++) {
                    if (this.cols[i][1] === 'D') {
                        for (var j = 0; j < this.rows.length; j++) {
                            if (this.rows[j][i] !== null && this.rows[j][i] !== undefined) {
                                var dateStr = new Date(this.rows[j][i].toString());
                                this.rows[j][i] = dateFormat(dateStr, "isoDate") + "T" + dateFormat(dateStr, "isoTime");
                            }
                        }
                    }
                }
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
    }
}
exports.MocaResults = MocaResults;
//# sourceMappingURL=mocaResults.js.map