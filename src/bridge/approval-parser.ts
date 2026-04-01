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

  const idMatch = text.match(/ID:\s*(plugin:[a-f0-9-]+)/i);
  if (!idMatch) return null;

  const titleMatch = text.match(/Title:\s*(.+)/);
  const toolMatch = text.match(/^Tool:\s*(\S+)/m);
  const pluginMatch = text.match(/Plugin:\s*(\S+)/);
  const riskMatch = text.match(/Risk Score:\s*\*?\*?\s*[`]?([\d.]+)[`]?\s*\*?\*?\s*\/\s*1\.0/);
  const detectedMatch = text.match(/Detected:\s*\*?\*?\s*(.+)/);


  // Extract parameters block
  let parameters = "";
  const paramStart = text.indexOf("Parameters:");
  if (paramStart !== -1) {
    const afterParam = text.slice(paramStart + "Parameters:".length);
    const blockMatch = afterParam.match(/```([\s\S]*?)```/);
    if (blockMatch) {
      parameters = blockMatch[1].trim();
    } else {
      // Try to find JSON block
      const jsonMatch = afterParam.match(/\{[\s\S]*?\}/);
      if (jsonMatch) parameters = jsonMatch[0].trim();
    }
  }

  return {
    approvalId: idMatch[1],
    title: titleMatch?.[1]?.trim() ?? "Approval Required",
    toolName: toolMatch?.[1] ?? "unknown",
    pluginName: pluginMatch?.[1] ?? "unknown",
    riskScore: riskMatch?.[1] ?? "?",
    detected: detectedMatch?.[1]?.trim() ?? "",
    parameters,
  };
}
