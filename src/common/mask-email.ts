/** `ada@stu.ui.edu.ng` -> `a***@stu.ui.edu.ng`. The only form of an email the API echoes back. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const first = local[0] ?? '*';
  return `${first}***@${domain}`;
}
