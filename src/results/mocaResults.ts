

export class MocaResults {

    // metadata/cols index info:
    // 0 - name
    // 1 - type
    // 2 - length
    cols: Object[][];
    rows: Object[][];
    msg: string;
    needsApprovalToExecute: boolean;
    superUser: boolean;

    constructor(data: any) {
        if (data['results']) {
            if (data['results']['metadata']) {
                this.cols = data['results']['metadata'] as Object[][];
            } else {
                this.cols = [];
            }

            if (data['results']['values']) {
                this.rows = data['results']['values'] as Object[][];
            } else {
                this.rows = [];
            }
        } else {
            this.cols = [];
            this.rows = [];
        }


        if (data['exception']) {
            if (data['exception']['message']) {
                this.msg = data['exception']['message'] as string;
            } else {
                this.msg = "";
            }
        } else {
            this.msg = "";
        }

        if (data['needsApprovalToExecute']) {
            this.needsApprovalToExecute = true;
        } else {
            this.needsApprovalToExecute = false;
        }

        if (data['superUser']) {
            this.superUser = true;
        } else {
            this.superUser = false;
        }
    }
}