/**
 * Formatting utilities for CLI output
 * Replicates Python's tabulate functionality with grid format
 */

export interface TableColumn {
  name: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface TableRow {
  [key: string]: any;
}

/**
 * Format a table with grid borders similar to Python's tabulate
 * @param data Array of objects representing table rows
 * @param headers Array of column names
 * @param tablefmt Format type (only 'grid' supported)
 * @returns Formatted table string
 */
export function tabulate(data: TableRow[], headers: string[], tablefmt: string = 'grid'): string {
  if (tablefmt !== 'grid') {
    throw new Error(`Unsupported table format: ${tablefmt}`);
  }

  if (data.length === 0) {
    return '';
  }

  // Calculate column widths
  const columnWidths: number[] = headers.map(header => header.length);
  
  data.forEach(row => {
    headers.forEach((header, index) => {
      const value = String(row[header] || '');
      columnWidths[index] = Math.max(columnWidths[index], value.length);
    });
  });

  // Ensure minimum width of 1
  columnWidths.forEach((width, index) => {
    columnWidths[index] = Math.max(width, 1);
  });

  // Build the table
  let result = '';
  
  // Top border
  result += '+' + columnWidths.map(w => '='.repeat(w + 2)).join('+') + '+\n';
  
  // Header row
  result += '|';
  headers.forEach((header, index) => {
    result += ` ${header.padEnd(columnWidths[index])} |`;
  });
  result += '\n';
  
  // Header separator
  result += '+' + columnWidths.map(w => '='.repeat(w + 2)).join('+') + '+\n';
  
  // Data rows
  data.forEach(row => {
    result += '|';
    headers.forEach((header, index) => {
      const value = String(row[header] || '');
      result += ` ${value.padEnd(columnWidths[index])} |`;
    });
    result += '\n';
  });
  
  // Bottom border
  result += '+' + columnWidths.map(w => '='.repeat(w + 2)).join('+') + '+';
  
  return result;
}

/**
 * Format mech list for CLI output
 * @param mechs Array of mech objects
 * @returns Formatted table string
 */
export function formatMechList(mechs: any[]): string {
  if (!mechs || mechs.length === 0) {
    return 'No mechs found';
  }

  const headers = [
    'Service Id',
    'Mech Type',
    'Mech Address',
    'Total Deliveries',
    'Metadata Link'
  ];

  const data = mechs.map(mech => ({
    'Service Id': mech.service?.id || '',
    'Mech Type': mech.mech_type || '',
    'Mech Address': mech.address || '',
    'Total Deliveries': mech.service?.totalDeliveries || '',
    'Metadata Link': mech.service?.metadata?.metadata ? 
      `https://gateway.autonolas.tech/ipfs/f01701220${mech.service.metadata.metadata.slice(2)}` : 
      'N/A'
  }));

  return tabulate(data, headers, 'grid');
}

/**
 * Format tool list for CLI output
 * @param tools Array of tool objects
 * @returns Formatted table string
 */
export function formatToolList(tools: any[]): string {
  if (!tools || tools.length === 0) {
    return 'No tools found';
  }

  const headers = [
    'Unique Identifier',
    'Tool Name',
    'Agent ID',
    'Is Marketplace Supported'
  ];

  const data = tools.map(tool => ({
    'Unique Identifier': tool.unique_identifier || '',
    'Tool Name': tool.tool_name || '',
    'Agent ID': tool.agent_id || '',
    'Is Marketplace Supported': tool.is_marketplace_supported ? 'Yes' : 'No'
  }));

  return tabulate(data, headers, 'grid');
}

/**
 * Format schema for CLI output
 * @param schema Schema object
 * @param schemaType Type of schema ('input' or 'output')
 * @returns Formatted table string
 */
export function formatSchema(schema: any, schemaType: 'input' | 'output'): string {
  if (!schema) {
    return `${schemaType} schema not available`;
  }

  if (schemaType === 'input') {
    const headers = ['Field', 'Value'];
    const data = Object.entries(schema).map(([key, value]) => ({
      'Field': key,
      'Value': String(value)
    }));
    return tabulate(data, headers, 'grid');
  } else {
    const headers = ['Field', 'Type', 'Description'];
    const data = Object.entries(schema).map(([key, value]: [string, any]) => ({
      'Field': key,
      'Type': value.type || '',
      'Description': value.description || ''
    }));
    return tabulate(data, headers, 'grid');
  }
}

/**
 * Format error message for CLI output
 * @param message Error message
 * @param error Optional error object
 * @returns Formatted error string
 */
export function formatError(message: string, error?: any): string {
  let result = `Error: ${message}`;
  if (error) {
    result += `\nDetails: ${error.message || String(error)}`;
  }
  return result;
}

/**
 * Format transaction URL
 * @param transactionHash Transaction hash
 * @param baseUrl Base URL template
 * @returns Formatted URL
 */
export function formatTransactionUrl(transactionHash: string, baseUrl: string): string {
  return baseUrl.replace('{transaction_digest}', transactionHash);
}

/**
 * Format IPFS URL
 * @param ipfsHash IPFS hash
 * @returns Formatted IPFS URL
 */
export function formatIpfsUrl(ipfsHash: string): string {
  return `https://gateway.autonolas.tech/ipfs/f01701220${ipfsHash.slice(2)}`;
}
