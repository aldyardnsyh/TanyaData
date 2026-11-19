/**
 * A-07 / §2.6: satu sumber ikon untuk seluruh aplikasi.
 * Stroke 1,5 + currentColor ditetapkan global oleh IconProvider (LucideProvider
 * di root layout); modul ini hanya memberi alias bernama agar semua UI mengimpor
 * ikon dari satu tempat, bukan langsung dari 'lucide-react'.
 */
export {
  AlertTriangle as IconAlertTriangle,
  ArrowDown as IconArrowDown,
  ArrowLeft as IconArrowLeft,
  ArrowRight as IconArrowRight,
  ArrowDownRight as IconArrowDownRight,
  ArrowUpRight as IconArrowUpRight,
  ArrowUp as IconArrowUp,
  ArrowUpDown as IconArrowUpDown,
  Check as IconCheck,
  CheckCircle as IconCheckCircle,
  ChevronDown as IconChevronDown,
  ChevronRight as IconChevronRight,
  Clock as IconClock,
  Copy as IconCopy,
  Database as IconDatabase,
  Download as IconDownload,
  FileSpreadsheet as IconFileSpreadsheet,
  FileText as IconFileText,
  History as IconHistory,
  Info as IconInfo,
  LayoutDashboard as IconLayoutDashboard,
  Loader2 as IconLoader,
  MapPin as IconMapPin,
  Menu as IconMenu,
  MessageSquare as IconMessageSquare,
  Minus as IconMinus,
  Plus as IconPlus,
  RefreshCw as IconRefresh,
  ScanSearch as IconScanSearch,
  Search as IconSearch,
  Send as IconSend,
  Settings as IconSettings,
  Shield as IconShield,
  Trash2 as IconTrash,
  UploadCloud as IconUpload,
  X as IconX,
} from 'lucide-react';