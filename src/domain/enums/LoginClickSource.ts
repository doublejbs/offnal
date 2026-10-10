/** Where a Kakao login button was pressed (`login_clicked.from`, Spec §26.5). */
export enum LoginClickSource {
  /** The blurred preview gate after the first recognition pass. */
  GATE = 'gate',
  /** The signed-out entry screen ("이미 이용 중이신가요?"). */
  LANDING = 'landing',
}
