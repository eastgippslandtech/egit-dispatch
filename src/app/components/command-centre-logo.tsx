import Image from "next/image";

const logoVariants = {
  "horizontal-dark": {
    src: "/assets/command-centre/logo-horizontal-dark.svg",
    width: 1500,
    height: 512,
  },
  "horizontal-light": {
    src: "/assets/command-centre/logo-horizontal-light.svg",
    width: 1500,
    height: 512,
  },
  "stacked-dark": {
    src: "/assets/command-centre/logo-stacked-dark.svg",
    width: 760,
    height: 680,
  },
  "stacked-light": {
    src: "/assets/command-centre/logo-stacked-light.svg",
    width: 760,
    height: 680,
  },
  "icon-colour": {
    src: "/assets/command-centre/icon-full-colour.png",
    width: 2048,
    height: 2048,
  },
  "powered-by-dark": {
    src: "/assets/command-centre/powered-by-egit-dark.svg",
    width: 1880,
    height: 512,
  },
  "powered-by-light": {
    src: "/assets/command-centre/powered-by-egit-light.svg",
    width: 1880,
    height: 512,
  },
} as const;

export type CommandCentreLogoVariant = keyof typeof logoVariants;

export function CommandCentreLogo({
  variant,
  className,
  decorative = false,
  priority = false,
  testId,
}: {
  variant: CommandCentreLogoVariant;
  className?: string;
  decorative?: boolean;
  priority?: boolean;
  testId?: string;
}) {
  const logo = logoVariants[variant];

  return (
    <Image
      alt={decorative ? "" : "Command Centre"}
      className={className}
      data-command-centre-logo={variant}
      data-testid={testId}
      height={logo.height}
      priority={priority}
      src={logo.src}
      unoptimized
      width={logo.width}
    />
  );
}
