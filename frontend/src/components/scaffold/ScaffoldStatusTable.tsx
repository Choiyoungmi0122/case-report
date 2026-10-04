type ScaffoldStatusRow = {
  id: string;
  cells: string[];
};

type ScaffoldStatusTableProps = {
  headers: string[];
  rows: ScaffoldStatusRow[];
};

export default function ScaffoldStatusTable({
  headers,
  rows
}: ScaffoldStatusTableProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                style={{
                  textAlign: 'left',
                  padding: 12,
                  borderBottom: '1px solid #d7e0e8',
                  color: '#17324d'
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {row.cells.map((cell, index) => (
                <td
                  key={`${row.id}-${index}`}
                  style={{ padding: 12, borderBottom: '1px solid #eef2f6' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
