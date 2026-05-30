export interface ParsedApproval {
  approvalId: string;
  title: string;
  toolName: string;
  pluginName: string;
  riskScore: string;
  detected: string;
  parameters: string;
}

export function parseApprovalMessage(text: string): ParsedApproval | null {
  if (!text.includes("Plugin approval required")) return null;
  // ID may be plain ("ID: plugin:...") or openclaw-native bold mrkdwn
  // ("*Approval ID:* plugin:...") — tolerate asterisks/whitespace between the
  // label and the id. (openclaw >=2026.5 switched to native Block Kit rendering.)
  const idMatch = text.match(/ID:[\s*]*(plugin:[a-f0-9-]+)/i);
  if (!idMatch) return null;
  const titleMatch = text.match(/\**\s*Title:\**\s*(.+)/);
  const toolMatch = text.match(/^\**\s*Tool:\**\s*(\S+)/m);
  const pluginMatch = text.match(/\**\s*Plugin:\**\s*(\S+)/);
  const riskMatch = text.match(/\[([\d.]+)\]/) ?? text.match(/Risk Score:\s*\*?\*?\s*[`]?([\d.]+)/);
  const detectedMatch = text.match(/Detected:\s*\*?\*?\s*([^|\n]+)/);
  let parameters = "";
  // 1. Try Parameters: block (legacy format)
  const paramStart = text.indexOf("Parameters:");
  if (paramStart !== -1) {
    const afterParam = text.slice(paramStart + "Parameters:".length);
    const blockMatch = afterParam.match(/```([\s\S]*?)```/);
    if (blockMatch) parameters = blockMatch[1].trim();
    else { const jsonMatch = afterParam.match(/\{[\s\S]*?\}/); if (jsonMatch) parameters = jsonMatch[0].trim(); }
  }
  if (!parameters) { const cp = text.match(/params:(\{[^}]+\})/); if (cp) parameters = cp[1]; }
  // 2. Try Command:/File:/URL: from description (new format from formatDescription)
  if (!parameters) {
    const cmdMatch = text.match(/^\**\s*Command:\**\s*(.+?)\**\s*$/m);
    if (cmdMatch) parameters = JSON.stringify({ command: cmdMatch[1].trim() });
  }
  if (!parameters) {
    const fileMatch = text.match(/^\**\s*File:\**\s*(.+?)\**\s*$/m);
    if (fileMatch) parameters = JSON.stringify({ file_path: fileMatch[1].trim() });
  }
  if (!parameters) {
    const urlMatch = text.match(/^\**\s*URL:\**\s*(.+?)\**\s*$/m);
    if (urlMatch) parameters = JSON.stringify({ url: urlMatch[1].trim() });
  }
  return {
    approvalId: idMatch[1],
    title: titleMatch?.[1]?.trim() ?? "Approval Required",
    toolName: toolMatch?.[1] ?? "unknown",
    pluginName: pluginMatch?.[1] ?? "unknown",
    riskScore: riskMatch?.[1] ?? riskMatch?.[2] ?? "?",
    detected: (detectedMatch?.[1] ?? "").trim(),
    parameters,
  };
}
