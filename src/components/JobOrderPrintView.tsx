import type { JobOrder, Lot, Engine } from "@/lib/db-types";
import type { StandardColor } from "@/hooks/use-colors";
import { cairoDateLabel, serverNowMs } from "@/lib/time";

interface Props {
  jobOrder: JobOrder;
  lots: { lot: Lot; count: number }[];
  engines?: Engine[];
  colors: StandardColor[];
  isContract?: boolean;
  contractCompany?: string | null;
  vinLotIds?: (string | null)[]; // parallel to vin_sequence, lot_id per VIN
}

const VINS_PER_PAGE = 45; // 3 columns x 15 rows
const ENGINES_PER_PAGE = 45; // 3 columns x 15 rows

type VinItem =
  | { type: "vin"; vin: string; globalIdx: number }
  | { type: "separator"; label: string };

export function JobOrderPrintView({
  jobOrder,
  lots,
  engines = [],
  colors,
  isContract = false,
  contractCompany = null,
  vinLotIds,
}: Props) {
  const vins = jobOrder.vin_sequence ?? [];

  // Build header text
  const lotHeaderText =
    lots.length === 1
      ? `Lot: ${lots[0].lot.lot_code ?? "—"}${
          lots[0].lot.chinese_number
            ? ` / CN: ${lots[0].lot.chinese_number}`
            : ""
        }`
      : lots.map((l) => `${l.lot.lot_code ?? "—"} (${l.count})`).join(" & ");
  const modelHeaderText =
    [...new Set(lots.map((l) => l.lot.model).filter(Boolean))].join(" / ") ||
    "—";

  // Build VIN items list with separators between lot groups
  const vinItems: VinItem[] = [];
  const isMultiLot =
    vinLotIds && new Set(vinLotIds.filter(Boolean)).size > 1;

  if (isMultiLot && vinLotIds) {
    let currentLotId: string | null | undefined = undefined;
    for (let i = 0; i < vins.length; i++) {
      const lid = vinLotIds[i] ?? null;
      if (lid !== currentLotId) {
        if (currentLotId !== undefined) {
          // Separator for the NEW lot group starting at this VIN
          const lotInfo = lots.find((l) => l.lot.id === lid);
          const lotCode = lotInfo?.lot.lot_code ?? "—";
          const lotCount = lotInfo?.count ?? 0;
          vinItems.push({
            type: "separator",
            label: `— ${lotCode} (${lotCount} units) —`,
          });
        }
        currentLotId = lid;
      }
      vinItems.push({ type: "vin", vin: vins[i], globalIdx: i });
    }
  } else {
    for (let i = 0; i < vins.length; i++) {
      vinItems.push({ type: "vin", vin: vins[i], globalIdx: i });
    }
  }

  // Paginate VIN items: 45 VINs per page (separators don't count toward limit)
  const vinPages: VinItem[][] = [];
  let currentPage: VinItem[] = [];
  let vinCountOnPage = 0;
  for (const item of vinItems) {
    if (item.type === "vin") {
      if (vinCountOnPage >= VINS_PER_PAGE && currentPage.length > 0) {
        vinPages.push(currentPage);
        currentPage = [];
        vinCountOnPage = 0;
      }
      currentPage.push(item);
      vinCountOnPage++;
    } else {
      // separator -- only add if page already has VINs (won't start a page)
      if (vinCountOnPage > 0) {
        currentPage.push(item);
      }
    }
  }
  if (currentPage.length > 0) vinPages.push(currentPage);
  if (vinPages.length === 0) vinPages.push([]);

  const engineNumbers = engines.map((e) => e.engine_number);
  const enginePages: string[][] = [];
  for (let i = 0; i < engineNumbers.length; i += ENGINES_PER_PAGE) {
    enginePages.push(engineNumbers.slice(i, i + ENGINES_PER_PAGE));
  }

  const totalPages = vinPages.length + enginePages.length;
  const date = cairoDateLabel(jobOrder.released_at_cairo)
    ?? new Date(serverNowMs()).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

  // Build segments from page items: split at separators into groups of VINs
  // Each segment gets its own 3-column grid, with a dashed separator between segments
  const buildSegments = (
    pageItems: VinItem[]
  ): { vins: { vin: string; globalIdx: number }[]; separator?: VinItem }[] => {
    const segments: {
      vins: { vin: string; globalIdx: number }[];
      separator?: VinItem;
    }[] = [];
    let currentSegment: { vin: string; globalIdx: number }[] = [];
    let pendingSeparator: VinItem | null = null;

    for (const item of pageItems) {
      if (item.type === "vin") {
        if (pendingSeparator && currentSegment.length > 0) {
          segments.push({ vins: currentSegment, separator: pendingSeparator });
          currentSegment = [];
          pendingSeparator = null;
        }
        currentSegment.push(item);
      } else {
        pendingSeparator = item;
      }
    }
    if (currentSegment.length > 0) {
      segments.push({ vins: currentSegment });
    }
    return segments;
  };

  // Helper: render VIN items for one page, with lot separators between segments
  const renderVinPage = (pageItems: VinItem[], pageIdx: number) => {
    const segments = buildSegments(pageItems);

    return (
      <>
        {segments.map((seg, segIdx) => {
          // Compute the global offset for numbering: all VINs before this segment
          let globalOffset = 0;
          for (let p = 0; p < pageIdx; p++) {
            globalOffset += vinPages[p].filter(
              (it) => it.type === "vin"
            ).length;
          }
          // Plus VINs in previous segments on this page
          for (let s = 0; s < segIdx; s++) {
            globalOffset += segments[s].vins.length;
          }

          return (
            <div key={segIdx}>
              {/* Separator before this segment (not before the first segment) */}
              {segIdx > 0 && seg.separator && (
                <div
                  style={{
                    borderBottom: "2px dashed #999",
                    padding: "6px 2px",
                    textAlign: "center",
                    fontSize: "7pt",
                    color: "#666",
                    margin: "4px 0",
                  }}
                >
                  {seg.separator.type === "separator"
                    ? seg.separator.label
                    : ""}
                </div>
              )}
              {/* 3-column VIN table */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: "0.5cm",
                }}
              >
                {[0, 1, 2].map((colIdx) => {
                  const colVins = seg.vins.slice(
                    colIdx * 15,
                    (colIdx + 1) * 15
                  );
                  return (
                    <table
                      key={colIdx}
                      style={{ width: "100%", borderCollapse: "collapse" }}
                    >
                      <thead>
                        <tr style={{ borderBottom: "2px solid #000" }}>
                          <th
                            style={{
                              fontSize: "8pt",
                              padding: "4px 2px",
                              textAlign: "left",
                              fontWeight: 700,
                              width: "2em",
                            }}
                          >
                            #
                          </th>
                          <th
                            style={{
                              fontSize: "8pt",
                              padding: "4px 2px",
                              textAlign: "left",
                              fontWeight: 700,
                            }}
                          >
                            Chassis (VIN)
                          </th>
                          <th
                            style={{
                              fontSize: "8pt",
                              padding: "4px 2px",
                              textAlign: "center",
                              fontWeight: 700,
                              width: "14pt",
                            }}
                          >
                            &#10003;
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {colVins.map((v, rowIdx) => (
                          <tr
                            key={rowIdx}
                            style={{ borderBottom: "1px solid #000" }}
                          >
                            <td
                              style={{
                                fontSize: "10pt",
                                padding: "3px 2px",
                                fontWeight: 700,
                                width: "2em",
                              }}
                            >
                              {colIdx * 15 + rowIdx + 1 + globalOffset}
                            </td>
                            <td
                              style={{
                                fontSize: "10pt",
                                padding: "3px 2px",
                                fontFamily: "monospace",
                                fontWeight: 700,
                              }}
                            >
                              {v.vin}
                            </td>
                            <td
                              style={{
                                fontSize: "12pt",
                                padding: "3px 2px",
                                textAlign: "center",
                              }}
                            >
                              &#9744;
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })}
              </div>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="print-area">
      {vinPages.map((pageItems, pageIdx) => (
        <div
          key={`vin-${pageIdx}`}
          className="print-page"
          style={{
            minHeight: "100vh",
            padding: "1cm",
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "0.5cm",
            }}
          >
            <div>
              <div style={{ fontSize: "18pt", fontWeight: 700 }}>
                Job Order: {jobOrder.job_code}
              </div>
              {isContract ? (
                <div
                  style={{
                    fontSize: "11pt",
                    fontWeight: 700,
                    marginTop: 4,
                  }}
                >
                  Contract: {contractCompany ?? "—"} | Year:{" "}
                  {jobOrder.model_year ?? "—"}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: "11pt",
                    fontWeight: 700,
                    marginTop: 4,
                  }}
                >
                  {lotHeaderText} | Model: {modelHeaderText} | Year:{" "}
                  {jobOrder.model_year ?? "—"}
                </div>
              )}
              <div style={{ fontSize: "10pt", fontWeight: 700, marginTop: 2 }}>
                Date: {date} | Units: {jobOrder.units}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "12pt", fontWeight: 700 }}>
                MPC DEPARTMENT
              </div>
              <div style={{ fontSize: "9pt", fontWeight: 700 }}>
                PRODUCTION PLANNING SECTION
              </div>
              <div
                style={{
                  fontSize: "10pt",
                  fontWeight: 700,
                  marginTop: 4,
                }}
              >
                Engines: {engines.length}
              </div>
            </div>
          </div>

          {/* Color Table -- first page only */}
          {pageIdx === 0 && (
            <div style={{ marginBottom: "0.5cm", marginTop: "0.25cm" }}>
              <div
                style={{
                  fontSize: "9pt",
                  fontWeight: 700,
                  marginBottom: "4px",
                }}
              >
                Color Plan
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  border: "1px solid #000",
                  fontSize: "7pt",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid #000" }}>
                    {colors.map((color) => (
                      <th
                        key={color.id}
                        style={{
                          padding: "4px 2px",
                          textAlign: "center",
                          borderRight: "1px solid #000",
                          fontWeight: 700,
                          fontSize: "8pt",
                        }}
                      >
                        {color.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {colors.map((color, idx) => (
                      <td
                        key={color.id}
                        style={{
                          padding: "4px 2px",
                          textAlign: "center",
                          fontWeight: 700,
                          borderRight:
                            idx < colors.length - 1
                              ? "1px solid #000"
                              : "none",
                        }}
                      >
                        {((
                          jobOrder.color_plan as
                            | Record<string, number>
                            | null
                        )?.[color.id]) ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Signature block -- first page only */}
          {pageIdx === 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "1cm",
                marginBottom: "0.75cm",
                marginTop: "0.25cm",
              }}
            >
              <div
                style={{
                  borderBottom: "1px solid #000",
                  paddingBottom: 4,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    fontWeight: 700,
                    marginBottom: 20,
                  }}
                >
                  Production Control
                </div>
              </div>
              <div
                style={{
                  borderBottom: "1px solid #000",
                  paddingBottom: 4,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    fontWeight: 700,
                    marginBottom: 20,
                  }}
                >
                  Production Planning Eng.
                </div>
              </div>
              <div
                style={{
                  borderBottom: "1px solid #000",
                  paddingBottom: 4,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    fontWeight: 700,
                    marginBottom: 20,
                  }}
                >
                  Senior Manager
                </div>
              </div>
            </div>
          )}

          {/* VIN Columns with lot separators */}
          {renderVinPage(pageItems, pageIdx)}

          {/* Page number */}
          <div
            style={{
              position: "absolute",
              bottom: "0.5cm",
              right: "1cm",
              fontSize: "8pt",
              fontWeight: 700,
            }}
          >
            Page {pageIdx + 1} of {totalPages}
          </div>
        </div>
      ))}

      {/* Engine pages */}
      {enginePages.map((pageEngines, enginePageIdx) => (
        <div
          key={`engine-${enginePageIdx}`}
          className="print-page"
          style={{
            minHeight: "100vh",
            padding: "1cm",
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "0.5cm",
            }}
          >
            <div>
              <div style={{ fontSize: "18pt", fontWeight: 700 }}>
                Job Order: {jobOrder.job_code}
              </div>
              {isContract ? (
                <div
                  style={{
                    fontSize: "11pt",
                    fontWeight: 700,
                    marginTop: 4,
                  }}
                >
                  Contract: {contractCompany ?? "—"} | Year:{" "}
                  {jobOrder.model_year ?? "—"}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: "11pt",
                    fontWeight: 700,
                    marginTop: 4,
                  }}
                >
                  {lotHeaderText} | Model: {modelHeaderText} | Year:{" "}
                  {jobOrder.model_year ?? "—"}
                </div>
              )}
              <div style={{ fontSize: "10pt", fontWeight: 700, marginTop: 2 }}>
                Date: {date} | Units: {jobOrder.units}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "12pt", fontWeight: 700 }}>
                MPC DEPARTMENT
              </div>
              <div style={{ fontSize: "9pt", fontWeight: 700 }}>
                PRODUCTION PLANNING SECTION
              </div>
              <div
                style={{
                  fontSize: "10pt",
                  fontWeight: 700,
                  marginTop: 4,
                }}
              >
                Engines: {engines.length}
              </div>
            </div>
          </div>

          {/* Color Table -- first engine page only */}
          {enginePageIdx === 0 && (
            <div style={{ marginBottom: "0.5cm", marginTop: "0.25cm" }}>
              <div
                style={{
                  fontSize: "9pt",
                  fontWeight: 700,
                  marginBottom: "4px",
                }}
              >
                Color Plan
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  border: "1px solid #000",
                  fontSize: "7pt",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid #000" }}>
                    {colors.map((color) => (
                      <th
                        key={color.id}
                        style={{
                          padding: "4px 2px",
                          textAlign: "center",
                          borderRight: "1px solid #000",
                          fontWeight: 700,
                          fontSize: "8pt",
                        }}
                      >
                        {color.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {colors.map((color, idx) => (
                      <td
                        key={color.id}
                        style={{
                          padding: "4px 2px",
                          textAlign: "center",
                          fontWeight: 700,
                          borderRight:
                            idx < colors.length - 1
                              ? "1px solid #000"
                              : "none",
                        }}
                      >
                        {((
                          jobOrder.color_plan as
                            | Record<string, number>
                            | null
                        )?.[color.id]) ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Signature block -- first engine page only */}
          {enginePageIdx === 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "1cm",
                marginBottom: "0.75cm",
                marginTop: "0.25cm",
              }}
            >
              <div
                style={{
                  borderBottom: "1px solid #000",
                  paddingBottom: 4,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    fontWeight: 700,
                    marginBottom: 20,
                  }}
                >
                  Production Control
                </div>
              </div>
              <div
                style={{
                  borderBottom: "1px solid #000",
                  paddingBottom: 4,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    fontWeight: 700,
                    marginBottom: 20,
                  }}
                >
                  Production Planning Eng.
                </div>
              </div>
              <div
                style={{
                  borderBottom: "1px solid #000",
                  paddingBottom: 4,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    fontWeight: 700,
                    marginBottom: 20,
                  }}
                >
                  Senior Manager
                </div>
              </div>
            </div>
          )}

          {/* Engine Columns -- 3 columns, max 15 per column, with checkbox */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "0.5cm",
            }}
          >
            {[0, 1, 2].map((colIdx) => {
              const colEngines = pageEngines.slice(
                colIdx * 15,
                (colIdx + 1) * 15
              );
              return (
                <table
                  key={colIdx}
                  style={{ width: "100%", borderCollapse: "collapse" }}
                >
                  <thead>
                    <tr style={{ borderBottom: "2px solid #000" }}>
                      <th
                        style={{
                          fontSize: "8pt",
                          padding: "4px 2px",
                          textAlign: "left",
                          fontWeight: 700,
                          width: "2em",
                        }}
                      >
                        #
                      </th>
                      <th
                        style={{
                          fontSize: "8pt",
                          padding: "4px 2px",
                          textAlign: "left",
                          fontWeight: 700,
                        }}
                      >
                        Engine Number
                      </th>
                      <th
                        style={{
                          fontSize: "8pt",
                          padding: "4px 2px",
                          textAlign: "center",
                          fontWeight: 700,
                          width: "14pt",
                        }}
                      >
                        &#10003;
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {colEngines.map((engine, rowIdx) => (
                      <tr
                        key={rowIdx}
                        style={{ borderBottom: "1px solid #000" }}
                      >
                        <td
                          style={{
                            fontSize: "10pt",
                            padding: "3px 2px",
                            fontWeight: 700,
                            width: "2em",
                          }}
                        >
                          {colIdx * 15 +
                            rowIdx +
                            1 +
                            enginePageIdx * ENGINES_PER_PAGE}
                        </td>
                        <td
                          style={{
                            fontSize: "10pt",
                            padding: "3px 2px",
                            fontFamily: "monospace",
                            fontWeight: 700,
                          }}
                        >
                          {engine}
                        </td>
                        <td
                          style={{
                            fontSize: "12pt",
                            padding: "3px 2px",
                            textAlign: "center",
                          }}
                        >
                          &#9744;
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })}
          </div>

          {/* Page number */}
          <div
            style={{
              position: "absolute",
              bottom: "0.5cm",
              right: "1cm",
              fontSize: "8pt",
              fontWeight: 700,
            }}
          >
            Page {vinPages.length + enginePageIdx + 1} of {totalPages}
          </div>
        </div>
      ))}
    </div>
  );
}
