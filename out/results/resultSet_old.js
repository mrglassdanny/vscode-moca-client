"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function getWebView(res) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy"; script-src="nonce-nonce">
            <style>
                tr {
                    border: solid thin;
                    height: 30px;
                }
                th {
                    border: solid thin;
                    height: 30px;
                }
                td {
                    border: solid thin;
                    height: 30px;
                }
                    table { border-collapse: collapse; }
                #sts {
                    border: solid thin;
                    height: 30px;
                }
            </style>
        </head>
        <body>
            
        </script>
        <table id="resultSet">
        </table>
        <div id="sts">
        </div>
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <script nonce="nonce" src="">
       
            console.log(2);
            window.onload = function() {
                console.log(2);
                var res = ` + JSON.stringify(res) + `;

                var tb = document.getElementById("resultSet");

                var lefthead = document.createElement("th");
                lefthead.id = "lefthead";
                tb.appendChild(lefthead);
                res.cols.forEach(function(col) {
                    var header = document.createElement("th");
                    var htext = document.createTextNode(col);
                    header.appendChild(htext);
                    tb.appendChild(header);
                });

                res.rows.forEach(function(row) {
                    var tr = document.createElement("tr");
                    tb.appendChild(tr);
                    var leftpad = document.createElement("td");
                    leftpad.id = "leftpad";
                    tr.appendChild(leftpad);
                    row.forEach(function(field) {
                        var td = document.createElement("td");
                        var ftext = document.createTextNode(field);
                        tr.appendChild(ftext);
                    });
                });

                var statText = document.createTextNode("status: " + res.sts + " " + res.msg);

                document.getElementById("sts").appendChild(statText);
            }
        </body>
        </html>`;
}
exports.getWebView = getWebView;
//# sourceMappingURL=resultSet_old.js.map