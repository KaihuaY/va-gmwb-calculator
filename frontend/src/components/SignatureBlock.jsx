/**
 * SignatureBlock — REQUIRED on every rating detail page.
 *
 * The signature is the product. This component must render whenever a
 * published rating is shown. Hiding it is a programming error.
 */

import React from 'react';

export default function SignatureBlock({
  signedBy,
  credentials,
  signedAt,
  methodologyVersion,
  productSpecHash,
}) {
  // Fail loudly if required signed fields are missing — published ratings
  // must always be signed. If you see this in the UI, the upstream JSON has
  // status: published but no signed_by, which is a bug in publish_rating.py.
  if (!signedBy) {
    return (
      <div
        data-testid="signature-block-missing"
        role="alert"
        style={{
          padding: '16px',
          border: '2px solid #b91c1c',
          background: '#fee2e2',
          color: '#7f1d1d',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '13px',
        }}
      >
        ⚠ SIGNATURE BLOCK ERROR — this rating is marked published but has no
        signing actuary recorded. Please re-run <code>tools/publish_rating.py
        --sign</code>.
      </div>
    );
  }

  const hashShort = productSpecHash
    ? `${productSpecHash.slice(0, 4)}…${productSpecHash.slice(-4)}`
    : '—';

  return (
    <div
      data-testid="signature-block"
      style={{
        padding: '14px 18px',
        border: '1px solid #d1d5db',
        background: '#f9fafb',
        borderRadius: '8px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        lineHeight: 1.55,
        color: '#1f2937',
      }}
    >
      <div>
        <strong>Signed by</strong>&nbsp;
        <span data-testid="signed-by">{signedBy}</span>
        {credentials ? `, ${credentials}` : ''}
        &nbsp;·&nbsp;
        <span data-testid="signed-at">{signedAt || '—'}</span>
      </div>
      <div style={{ marginTop: '4px', color: '#4b5563' }}>
        Methodology&nbsp;
        <span data-testid="methodology-version">{methodologyVersion}</span>
        &nbsp;· Product spec hash:&nbsp;
        <span title={productSpecHash}>{hashShort}</span>
      </div>
    </div>
  );
}
