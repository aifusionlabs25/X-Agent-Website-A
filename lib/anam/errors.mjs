export class CaptureApplicationError extends Error {
 constructor(code,status=409){super(code);this.name='CaptureApplicationError';this.code=code;this.status=status;}
}
