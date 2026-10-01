import AuthRequired from '@/components/AuthRequired';
import TeamListView from '@/components/team/TeamListView';
import { getServerComponentContext } from '@/server/http/RequestContext';

const TeamsPage = async () => {
  const context = await getServerComponentContext();

  if (!context.user) {
    return (
      <AuthRequired
        returnTo="/teams"
        description="팀 공유는 관리자가 근무표를 한 번 올리면 팀원 모두가 각자 달력을 받는 기능이에요. 로그인하면 내 팀을 보거나 새 팀을 만들 수 있어요."
      />
    );
  }

  return <TeamListView />;
};

export default TeamsPage;
