import type { JobOrder, Lot, Engine } from "@/lib/db-types";
import type { StandardColor } from "@/hooks/use-colors";

interface Props {
  jobOrder: JobOrder;
  lot: Lot | null;
  engines?: Engine[];
  colors: StandardColor[];
  isContract?: boolean;
  contractCompany?: string | null;
}

const VINS_PER_PAGE = 45; // 3 columns x 15 rows
const ENGINES_PER_PAGE = 45; // 3 columns x 15 rows

export function JobOrderPrintView({ jobOrder, lot, engines = [], colors, isContract = false, contractCompany = null }: Props) {
  const vins = jobOrder.vin_sequence ?? [];
  const vinPages: string[][] = [];
  for (let i = 0; i < vins.length; i += VINS_PER_PAGE) {
    vinPages.push(vins.slice(i, i + VINS_PER_PAGE));
  }
  if (vinPages.length === 0) vinPages.push([]);

  const engineNumbers = engines.map(e => e.engine_number);
  const enginePages: string[][] = [];
  for (let i = 0; i < engineNumbers.length; i += ENGINES_PER_PAGE) {
    enginePages.push(engineNumbers.slice(i, i + ENGINES_PER_PAGE));
  }

  const totalPages = vinPages.length + enginePages.length;
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="print-area">
      {vinPages.map((pageVins, pageIdx) => (
        <div key={`vin-${pageIdx}`} className="print-page" style={{ minHeight: "100vh", padding: "1cm", boxSizing: "border-box", position: "relative" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5cm" }}>
            <div>
              <div style={{ fontSize: "18pt", fontWeight: 700 }}>Job Order: {jobOrder.job_code}</div>
              {isContract ? (
                <div style={{ fontSize: "11pt", marginTop: 4 }}>Contract: {contractCompany ?? "—"} | Year: {jobOrder.model_year ?? "—"}</div>
              ) : (
                <div style={{ fontSize: "11pt", marginTop: 4 }}>Lot: {lot?.lot_code ?? "—"}{lot?.chinese_number ? ` / CN: ${lot.chinese_number}` : ""} | Model: {lot?.model ?? "—"} | Year: {jobOrder.model_year ?? "—"}</div>
              )}
              <div style={{ fontSize: "10pt", color: "#666", marginTop: 2 }}>Date: {date} | Units: {jobOrder.units}</div>
            </div>
            <div style={{ fontSize: "10pt", color: "#666", textAlign: "right" }}>
              <div>Engines: {engines.length}</div>
            </div>
          </div>

          {/* Color Table — first page only, between header and signatures */}
          {pageIdx === 0 && (
            <div style={{ marginBottom: "0.5cm", marginTop: "0.25cm" }}>
              <div style={{ fontSize: "9pt", fontWeight: 600, marginBottom: "4px", color: "#666" }}>Color Plan</div>
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000", fontSize: "7pt" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #000" }}>
                    {colors.map(color => (
                      <th key={color.id} style={{ padding: "4px 2px", textAlign: "center", borderRight: "1px solid #000", fontWeight: 600, fontSize: "8pt" }}>
                        {color.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {colors.map((color, idx) => (
                      <td key={color.id} style={{ padding: "4px 2px", textAlign: "center", borderRight: idx < colors.length - 1 ? "1px solid #000" : "none" }}>
                        {((jobOrder.color_plan as Record<string, number> | null)?.[color.id]) ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Signature block — first page only */}
          {pageIdx === 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1cm", marginBottom: "0.75cm", marginTop: "0.25cm" }}>
              <div style={{ borderBottom: "1px solid #999", paddingBottom: 4, textAlign: "center" }}>
                <div style={{ fontSize: "8pt", color: "#666", marginBottom: 20 }}>Production Control</div>
                <div style={{ fontSize: "7pt", color: "#999" }}>Name &amp; Signature</div>
              </div>
              <div style={{ borderBottom: "1px solid #999", paddingBottom: 4, textAlign: "center" }}>
                <div style={{ fontSize: "8pt", color: "#666", marginBottom: 20 }}>Production Planning Eng.</div>
                <div style={{ fontSize: "7pt", color: "#999" }}>Name &amp; Signature</div>
              </div>
              <div style={{ borderBottom: "1px solid #999", paddingBottom: 4, textAlign: "center" }}>
                <div style={{ fontSize: "8pt", color: "#666", marginBottom: 20 }}>Senior Manager</div>
                <div style={{ fontSize: "7pt", color: "#999" }}>Name &amp; Signature</div>
              </div>
            </div>
          )}

          {/* VIN Columns — 3 columns, max 15 per column */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5cm" }}>
            {[0, 1, 2].map(colIdx => {
              const colVins = pageVins.slice(colIdx * 15, (colIdx + 1) * 15);
              return (
                <table key={colIdx} style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333" }}>
                      <th style={{ fontSize: "8pt", padding: "4px 2px", textAlign: "left", color: "#666" }}>#</th>
                      <th style={{ fontSize: "8pt", padding: "4px 2px", textAlign: "left", color: "#666" }}>Chassis (VIN)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {colVins.map((vin, rowIdx) => (
                      <tr key={rowIdx} style={{ borderBottom: "1px solid #ddd" }}>
                        <td style={{ fontSize: "10pt", padding: "3px 2px", color: "#666", width: "2em" }}>{colIdx * 15 + rowIdx + 1 + pageIdx * VINS_PER_PAGE}</td>
                        <td style={{ fontSize: "12pt", padding: "3px 2px", fontFamily: "monospace", fontWeight: 600 }}>{vin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })}
          </div>

          {/* Page number */}
          <div style={{ position: "absolute", bottom: "0.5cm", right: "1cm", fontSize: "8pt", color: "#999" }}>
            Page {pageIdx + 1} of {totalPages}
          </div>
        </div>
      ))}

      {/* Engine pages */}
      {enginePages.map((pageEngines, enginePageIdx) => (
        <div key={`engine-${enginePageIdx}`} className="print-page" style={{ minHeight: "100vh", padding: "1cm", boxSizing: "border-box", position: "relative" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5cm" }}>
            <div>
              <div style={{ fontSize: "18pt", fontWeight: 700 }}>Job Order: {jobOrder.job_code}</div>
              {isContract ? (
                <div style={{ fontSize: "11pt", marginTop: 4 }}>Contract: {contractCompany ?? "—"} | Year: {jobOrder.model_year ?? "—"}</div>
              ) : (
                <div style={{ fontSize: "11pt", marginTop: 4 }}>Lot: {lot?.lot_code ?? "—"}{lot?.chinese_number ? ` / CN: ${lot.chinese_number}` : ""} | Model: {lot?.model ?? "—"} | Year: {jobOrder.model_year ?? "—"}</div>
              )}
              <div style={{ fontSize: "10pt", color: "#666", marginTop: 2 }}>Date: {date} | Units: {jobOrder.units}</div>
            </div>
            <div style={{ fontSize: "10pt", color: "#666", textAlign: "right" }}>
              <div>Engines: {engines.length}</div>
            </div>
          </div>

          {/* Color Table — first engine page only */}
          {enginePageIdx === 0 && (
            <div style={{ marginBottom: "0.5cm", marginTop: "0.25cm" }}>
              <div style={{ fontSize: "9pt", fontWeight: 600, marginBottom: "4px", color: "#666" }}>Color Plan</div>
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000", fontSize: "7pt" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #000" }}>
                    {colors.map(color => (
                      <th key={color.id} style={{ padding: "4px 2px", textAlign: "center", borderRight: "1px solid #000", fontWeight: 600, fontSize: "8pt" }}>
                        {color.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {colors.map((color, idx) => (
                      <td key={color.id} style={{ padding: "4px 2px", textAlign: "center", borderRight: idx < colors.length - 1 ? "1px solid #000" : "none" }}>
                        {((jobOrder.color_plan as Record<string, number> | null)?.[color.id]) ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Signature block — first engine page only */}
          {enginePageIdx === 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1cm", marginBottom: "0.75cm", marginTop: "0.25cm" }}>
              <div style={{ borderBottom: "1px solid #999", paddingBottom: 4, textAlign: "center" }}>
                <div style={{ fontSize: "8pt", color: "#666", marginBottom: 20 }}>Production Control</div>
                <div style={{ fontSize: "7pt", color: "#999" }}>Name &amp; Signature</div>
              </div>
              <div style={{ borderBottom: "1px solid #999", paddingBottom: 4, textAlign: "center" }}>
                <div style={{ fontSize: "8pt", color: "#666", marginBottom: 20 }}>Production Planning Eng.</div>
                <div style={{ fontSize: "7pt", color: "#999" }}>Name &amp; Signature</div>
              </div>
              <div style={{ borderBottom: "1px solid #999", paddingBottom: 4, textAlign: "center" }}>
                <div style={{ fontSize: "8pt", color: "#666", marginBottom: 20 }}>Senior Manager</div>
                <div style={{ fontSize: "7pt", color: "#999" }}>Name &amp; Signature</div>
              </div>
            </div>
          )}

          {/* Engine Columns — 3 columns, max 15 per column */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5cm" }}>
            {[0, 1, 2].map(colIdx => {
              const colEngines = pageEngines.slice(colIdx * 15, (colIdx + 1) * 15);
              return (
                <table key={colIdx} style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333" }}>
                      <th style={{ fontSize: "8pt", padding: "4px 2px", textAlign: "left", color: "#666" }}>#</th>
                      <th style={{ fontSize: "8pt", padding: "4px 2px", textAlign: "left", color: "#666" }}>Engine Number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {colEngines.map((engine, rowIdx) => (
                      <tr key={rowIdx} style={{ borderBottom: "1px solid #ddd" }}>
                        <td style={{ fontSize: "10pt", padding: "3px 2px", color: "#666", width: "2em" }}>{colIdx * 15 + rowIdx + 1 + enginePageIdx * ENGINES_PER_PAGE}</td>
                        <td style={{ fontSize: "12pt", padding: "3px 2px", fontFamily: "monospace", fontWeight: 600 }}>{engine}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })}
          </div>

          {/* Page number */}
          <div style={{ position: "absolute", bottom: "0.5cm", right: "1cm", fontSize: "8pt", color: "#999" }}>
            Page {vinPages.length + enginePageIdx + 1} of {totalPages}
          </div>
        </div>
      ))}
    </div>
  );
}
