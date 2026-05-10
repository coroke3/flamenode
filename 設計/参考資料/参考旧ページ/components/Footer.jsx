import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXTwitter } from "@fortawesome/free-brands-svg-icons";
import { faInstagram } from "@fortawesome/free-brands-svg-icons";
import { faYoutube } from "@fortawesome/free-brands-svg-icons";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import Image from 'next/image'
import { useTheme } from 'next-themes'
function Footer() {
  const { resolvedTheme } = useTheme()
  let src

  switch (resolvedTheme) {
    case "light":
      src = "https://i.gyazo.com/70f00bd1015f6f121eb099b11ce450c0.png";
      break;
    case "dark":
      src = "https://i.gyazo.com/f736d6fc965df51b682ccc29bc842eaf.png";
      break;
    default:
      src = "https://i.gyazo.com/70f00bd1015f6f121eb099b11ce450c0.png";
      break;
  }

  return (
    <footer>
     
    </footer>
  );
}

export default Footer;
