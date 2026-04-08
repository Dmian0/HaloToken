const BLOCKED = [
  "rm -rf", "sudo rm", "chmod 777", "chown",
  "dd if=", "mkfs", "shutdown", "reboot",
  "curl | bash", "curl|bash", "wget | sh", "wget|sh",
  "> /dev/sda", "format c:",
];

export function validateCommand(cmd: string): { safe: boolean; reason?: string } {
  if (cmd.length > 500) {
    return { safe: false, reason: "Command exceeds 500 characters" };
  }
  const lower = cmd.toLowerCase();
  for (const blocked of BLOCKED) {
    if (lower.includes(blocked)) {
      return { safe: false, reason: `Blocked pattern: "${blocked}"` };
    }
  }
  return { safe: true };
}
