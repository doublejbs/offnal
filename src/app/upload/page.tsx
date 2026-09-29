import UploadPanel from '@/components/upload/UploadPanel';
import { getServerComponentContext } from '@/server/http/RequestContext';

const UploadPage = async () => {
  const context = await getServerComponentContext();

  return <UploadPanel isLoggedIn={Boolean(context.user)} />;
};

export default UploadPage;
