import Image from 'next/image';

export default function GhostlyBackground() {
    return (
        <div
            aria-hidden="true"
            className="absolute inset-0 z-0 flex select-none items-center justify-center overflow-hidden bg-black px-5 sm:px-10"
            data-home-loading-brand
        >
            <Image
                src="/brand/x-agents-metallic-loading.webp"
                alt=""
                width={1672}
                height={941}
                priority
                fetchPriority="high"
                sizes="100vw"
                className="h-auto w-[min(96vw,1200px)] object-contain sm:w-[min(88vw,1200px)]"
            />
        </div>
    );
}
