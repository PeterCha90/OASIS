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
  // Score from title "[0.6]" or description "Risk Score: **`0.6`**" or compact "score:0.6"
  const riskMatch = text.match(/\[([\d.]+)\]/) ?? text.match(/Risk Score:\s*\*?\*?\s*[`]?([\d.]+)/) ?? text.match(/score:([\d.]+)/);
  const detectedMatch = text.match(/Detected:\s*\*?\*?\s*([^|\n]+)/) ?? text.match(/detected:([^|]+)/);


  // Extract parameters — from code block, JSON, or compact format
  let parameters = "";
  const paramStart = text.indexOf("Parameters:");
  if (paramStart !== -1) {
    const afterParam = text.slice(paramStart + "Parameters:".length);
    const blockMatch = afterParam.match(/```([\s\S]*?)```/);
    if (blockMatch) {
      parameters = blockMatch[1].trim();
    } else {
      const jsonMatch = afterParam.match(/\{[\s\S]*?\}/);
      if (jsonMatch) parameters = jsonMatch[0].trim();
    }
  }
  // Compact format: params:{...}
  if (!parameters) {
    const compactParams = text.match(/params:(\{[^}]+\})/);
    if (compactParams) parameters = compactParams[1];
  }

  return {
    approvalId: idMatch[1],
    title: titleMatch?.[1]?.trim() ?? "Approval Required",
    toolName: toolMatch?.[1] ?? "unknown",
    pluginName: pluginMatch?.[1] ?? "unknown",
    riskScore: riskMatch?.[1] ?? riskMatch?.[2] ?? "?",
    detected: (detectedMatch?.[1] ?? detectedMatch?.[2] ?? "").trim(),
    parameters,
  };
}
