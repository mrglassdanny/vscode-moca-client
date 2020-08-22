"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ResultSetViewHtml {
    constructor(res) {
        this.res = res;
    }
    getColumns() {
        var colStr = "";
        this.res.cols.forEach(col => {
            colStr += '{ type: ';
            if (col._name.endsWith('flg')) {
                colStr += `'checkbox',`;
            }
            else {
                colStr += `'text',`;
            }
            colStr += ` title: '` + col._name + `', width: 120, readOnly:true },`;
        });
        colStr = colStr.substring(0, colStr.length - 1);
        return colStr;
    }
    getData() {
        let strArr = [];
        var colCount = this.res.cols.length;
        var colIdx = 0;
        this.res.rows.forEach(row => {
            row.forEach(e2 => {
                if (colIdx == 0) {
                    strArr.push("[`" + e2 + "`");
                }
                else if (colIdx == colCount - 1) {
                    strArr.push("`" + e2 + "`]");
                }
                else {
                    strArr.push("`" + e2 + "`");
                }
                colIdx++;
            });
            colIdx = 0;
        });
        return strArr.toString();
    }
}
exports.default = ResultSetViewHtml;
//# sourceMappingURL=ResultViewHtml.js.map