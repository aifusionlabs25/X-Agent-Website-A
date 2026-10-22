import React from 'react';

// next/image optimization needs a Next server; plain img preserves the real asset/layout.
export default function FixtureImage({ alt = '', ...props }) {
    delete props.priority;
    delete props.fill;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={alt} />;
}
