import JoinView from '@/components/join/JoinView';
import { getServerComponentContext } from '@/server/http/RequestContext';

type JoinPageProps = {
  params: Promise<{ token: string }>;
};

/** Invite link: before login only the team name (fetched client-side from the public lookup). */
const JoinPage = async ({ params }: JoinPageProps) => {
  const { token } = await params;
  const context = await getServerComponentContext();

  return <JoinView key={token} token={token} isLoggedIn={Boolean(context.user)} />;
};

export default JoinPage;
